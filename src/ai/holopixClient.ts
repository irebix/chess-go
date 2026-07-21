import { storage } from "uxp";
import type { AiGeneratedImage } from "../domain/aiCandidates";
import {
  describeComfyExecutionMessage,
  describeComfyQueueStatus
} from "./comfyPromptStatus";
import { COMFY_BASE_URL } from "./holopixEndpoint";
import {
  HolopixGenerationOutcomeUnknownError,
  isAmbiguousSubmissionTransportError
} from "./holopixErrors";
import {
  assessHolopixPaidBatch,
  findHolopixExecutionError,
  interpretHolopixHistoryEntry,
  type HolopixHistoryEntry,
  type HolopixHistoryImage
} from "./holopixGenerationResult";
import {
  collectHolopixImagesForPromptId,
  collectRecentHolopixImages
} from "./holopixRecovery";
import {
  buildHolopixSafeJpegUrl,
  decodeHolopixDirectJpeg,
  decodeHolopixSafeJpeg,
  HOLOPIX_DIRECT_PREVIEW_MAX_BYTES,
  HOLOPIX_SAFE_PREVIEW_MAX_BYTES,
  prepareHolopixSafePreviewWorkflow
} from "./holopixSafePreview";
import {
  assertHolopixWorkflow,
  describeHolopixPromptSource,
  prepareHolopixWorkflow,
  splitHolopixBatches,
  type ComfyWorkflow,
  type HolopixPromptSource
} from "./holopixWorkflow";
import {
  notifyHolopixSubmissionLifecycle,
  type HolopixSubmissionLifecycleEvent
} from "./holopixSubmissionLifecycle";

export type { HolopixSubmissionLifecycleEvent } from "./holopixSubmissionLifecycle";

let workflowPromise: Promise<ComfyWorkflow> | null = null;

interface UploadedImage {
  name: string;
  subfolder?: string;
  type?: string;
}

interface QueueResponse {
  prompt_id?: string;
  node_errors?: Record<string, unknown>;
  error?: string;
}

export interface QueuedComfyPrompt {
  promptId: string;
  stopStatusMonitor: () => void;
}

interface ComfyPromptStatusMonitor {
  start: (promptId: string) => void;
  stop: () => void;
}

interface HolopixGenerationCommonOptions {
  candidateCount: number;
  assetCode: string;
  signal?: AbortSignal;
  onBatchStarted?: (completedCandidates: number, totalCandidates: number) => void;
  onBatchCompleted?: (
    images: AiGeneratedImage[],
    completedBeforeBatch: number,
    totalCandidates: number,
    submission: HolopixCompletedBatchSubmission
  ) => void;
  onBeforeBatchSubmit?: (
    completedCandidates: number,
    totalCandidates: number
  ) => void | Promise<void>;
  onSubmissionLifecycle?: (event: HolopixSubmissionLifecycleEvent) => void;
  onStage?: (message: string) => void;
  onExecutionStatus?: (message: string) => void;
}

interface HolopixReferenceGenerationOptions {
  referenceBytes: Uint8Array;
  referenceFileName: string;
  referenceMediaType: string;
  itemName: string;
}

interface HolopixPromptGenerationOptions {
  promptText: string;
}

export interface HolopixPendingSubmission {
  promptId: string;
  assetCode: string;
}

export interface HolopixRecoveryResult {
  recentByAssetCode: Record<string, AiGeneratedImage[]>;
  byPromptId: Record<string, AiGeneratedImage[]>;
}

export interface HolopixCompletedBatchSubmission {
  key: string;
  promptId: string;
}

export type HolopixGenerationOptions = HolopixGenerationCommonOptions & (
  | HolopixReferenceGenerationOptions
  | HolopixPromptGenerationOptions
);

export async function checkHolopixAvailability(signal?: AbortSignal): Promise<void> {
  await fetchJson(`${COMFY_BASE_URL}/system_stats`, { signal }, 10_000);
}

export async function recoverRecentHolopixImages(
  assetCodes: string[],
  maxCandidates: number,
  signal?: AbortSignal,
  onStage?: (message: string) => void,
  pendingSubmissions: HolopixPendingSubmission[] = []
): Promise<HolopixRecoveryResult> {
  const byPromptId: Record<string, AiGeneratedImage[]> = {};
  const uniquePending = new Map(
    pendingSubmissions.map((submission) => [submission.promptId, submission])
  );
  for (const submission of uniquePending.values()) {
    try {
      const promptHistory = await fetchJson(
        `${COMFY_BASE_URL}/history/${encodeURIComponent(submission.promptId)}`,
        { signal },
        20_000
      ) as Record<string, HolopixHistoryEntry>;
      const images = collectHolopixImagesForPromptId(
        promptHistory,
        submission.promptId,
        submission.assetCode,
        COMFY_BASE_URL
      );
      byPromptId[submission.promptId] = await loadSafePreviews(images, signal, (message) => {
        onStage?.(`${submission.assetCode}（提交 ${submission.promptId}）：${message}`);
      });
    } catch (error) {
      if (isAbortError(error)) throw error;
      byPromptId[submission.promptId] = [];
      onStage?.(
        `${submission.assetCode} 的待确认提交 ${submission.promptId} 暂时无法精确恢复：`
        + `${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
  const recentByAssetCode = Object.fromEntries(
    assetCodes.map((assetCode) => [assetCode, [] as AiGeneratedImage[]])
  );
  try {
    const history = await fetchJson(
      `${COMFY_BASE_URL}/history?max_items=1000`,
      { signal },
      20_000
    ) as Record<string, HolopixHistoryEntry>;
    const recovered = collectRecentHolopixImages(history, assetCodes, COMFY_BASE_URL);
    for (const assetCode of assetCodes) {
      const images = (recovered[assetCode] ?? []).slice(0, maxCandidates);
      recentByAssetCode[assetCode] = await loadSafePreviews(images, signal, (message) => {
        onStage?.(`${assetCode}：${message}`);
      });
    }
  } catch (error) {
    if (isAbortError(error)) throw error;
    onStage?.(
      `宽泛历史恢复暂时不可用；已保留按 prompt_id 精确恢复的结果：`
      + `${error instanceof Error ? error.message : String(error)}`
    );
  }
  return { recentByAssetCode, byPromptId };
}

export async function generateHolopixImages(
  options: HolopixGenerationOptions
): Promise<AiGeneratedImage[]> {
  const baseWorkflow = await loadBundledHolopixWorkflow();
  await checkHolopixAvailability(options.signal);
  const suppliedPromptText = "promptText" in options ? options.promptText.trim() : undefined;
  const itemName = "itemName" in options ? options.itemName.trim() : undefined;
  let imageName: string | undefined;
  if (suppliedPromptText) {
    options.onStage?.("直接使用用户修改后的提示词；已跳过参考图上传与 QwenVL 提示词节点。");
  } else if ("referenceBytes" in options) {
    const uploaded = await uploadReference(options, options.signal);
    imageName = uploaded.subfolder ? `${uploaded.subfolder}/${uploaded.name}` : uploaded.name;
    options.onStage?.("参考图已上传；仅用于 QwenVL 提示词节点。");
  } else {
    throw new Error("用户提示词不能为空。");
  }
  const batches = splitHolopixBatches(options.candidateCount);
  const results: AiGeneratedImage[] = [];
  let sharedPromptText = suppliedPromptText;

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    throwIfAborted(options.signal);
    const batchSize = batches[batchIndex]!;
    options.onBatchStarted?.(results.length, options.candidateCount);
    const requestNonce = makeRequestNonce(batchIndex);
    const submissionKey = `${safePathSegment(options.assetCode)}:${requestNonce}:${batchIndex}`;
    const prepared = prepareHolopixWorkflow(baseWorkflow, {
      ...(imageName ? { imageName } : {}),
      ...(itemName ? { itemName } : {}),
      batchSize,
      requestNonce,
      confirmCost: true,
      filenamePrefix: `Holopix/ChessGo/${safePathSegment(options.assetCode)}`,
      ...(sharedPromptText ? { promptText: sharedPromptText } : {})
    });
    await options.onBeforeBatchSubmit?.(results.length, options.candidateCount);
    const submissionEvent = {
      submissionKey,
      completedBeforeBatch: results.length,
      batchSize,
      createdAt: Date.now(),
      ...(sharedPromptText ? { promptText: sharedPromptText } : {})
    };
    notifySubmissionLifecycle(options, { state: "started", ...submissionEvent });
    let queuedPrompt: QueuedComfyPrompt;
    let promptId: string;
    try {
      queuedPrompt = await queuePrompt(
        prepared.workflow,
        options.signal,
        options.onExecutionStatus
      );
      promptId = queuedPrompt.promptId;
    } catch (error) {
      if (!isAmbiguousSubmissionTransportError(error)) {
        notifySubmissionLifecycle(options, {
          state: "resolved",
          ...submissionEvent,
          outcome: "failed"
        });
        throw error;
      }
      throw new HolopixGenerationOutcomeUnknownError(
        "Holopix 提交请求的响应未确认；任务可能已经进入 ComfyUI，已禁止直接重试。",
        { submissionKey }
      );
    }
    notifySubmissionLifecycle(options, {
      state: "confirmed",
      ...submissionEvent,
      promptId
    });
    options.onStage?.(`Holopix 批次 ${batchIndex + 1}/${batches.length} 已提交。`);
    let generated: Awaited<ReturnType<typeof waitForImages>>;
    try {
      generated = await waitForImages(
        promptId,
        prepared.saveNodeId,
        prepared.promptCaptureNodeId,
        batchSize,
        prepared.timeoutSeconds + 45,
        options.signal
      );
    } catch (error) {
      if (error instanceof HolopixGenerationOutcomeUnknownError) {
        throw new HolopixGenerationOutcomeUnknownError(error.message, {
          promptId: error.promptId ?? promptId,
          submissionKey: error.submissionKey ?? submissionKey
        });
      }
      if (!isAbortError(error)) {
        notifySubmissionLifecycle(options, {
          state: "resolved",
          ...submissionEvent,
          promptId,
          outcome: "failed"
        });
        throw error;
      }
      throw new HolopixGenerationOutcomeUnknownError(
        "Holopix 已提交，但等待结果时被中止；任务可能仍在 ComfyUI 后台运行，已禁止直接重试。",
        { promptId, submissionKey }
      );
    } finally {
      queuedPrompt.stopStatusMonitor();
    }
    const images = generated.images;
    const hadSharedPrompt = Boolean(sharedPromptText);
    const assessment = assessHolopixPaidBatch(
      images,
      batchSize,
      sharedPromptText,
      generated.promptText
    );
    const batchPromptText = assessment.resolvedPromptText;
    const selectedImages = assessment.imagesToPreserve;
    if (!hadSharedPrompt && batchPromptText) {
      sharedPromptText = batchPromptText;
      options.onStage?.(`QwenVL 实际提示词：${summarizePrompt(sharedPromptText)}`);
    } else if (suppliedPromptText) {
      options.onStage?.(`Holopix 批次 ${batchIndex + 1} 直接使用用户提示词：${summarizePrompt(suppliedPromptText)}`);
    } else {
      options.onStage?.(
        batchPromptText
          ? `Holopix 批次 ${batchIndex + 1} 复用同一提示词：${summarizePrompt(batchPromptText)}`
          : `Holopix 批次 ${batchIndex + 1} 未返回提示词记录；仍保留已付费原图。`
      );
    }
    if (generated.terminalError) options.onStage?.(`${generated.terminalError} 已保留当前批次已有原图。`);
    options.onStage?.(`Holopix 批次 ${batchIndex + 1}/${batches.length} 已返回 ${selectedImages.length} 张原图。`);
    const completedBeforeBatch = results.length;
    const completedSubmission = { key: submissionKey, promptId };
    options.onBatchCompleted?.(
      selectedImages,
      completedBeforeBatch,
      options.candidateCount,
      completedSubmission
    );
    notifySubmissionLifecycle(options, {
      state: "resolved",
      ...submissionEvent,
      promptId,
      ...(batchPromptText ? { promptText: batchPromptText } : {}),
      outcome: "output",
      images: selectedImages
    });
    const completedImages = await loadSafePreviews(selectedImages, options.signal, options.onStage);
    results.push(...completedImages);
    options.onBatchCompleted?.(
      completedImages,
      completedBeforeBatch,
      options.candidateCount,
      completedSubmission
    );
    if (images.length < batchSize) {
      throw new Error(`Holopix 本批请求 ${batchSize} 张，但 ComfyUI 只返回 ${images.length} 张；已有结果已保留。`);
    }
    if (assessment.promptMismatchError) throw new Error(assessment.promptMismatchError);
    if (batchIndex < batches.length - 1 && (!sharedPromptText || generated.terminalError)) {
      throw new Error("Holopix 当前批次已保留，但无法安全复用提示词；后续批次未提交。");
    }
  }

  return results;
}

async function loadSafePreviews(
  images: AiGeneratedImage[],
  signal?: AbortSignal,
  onStage?: (message: string) => void,
  allowWorkflowFallback = true
): Promise<AiGeneratedImage[]> {
  const results: AiGeneratedImage[] = [];
  for (let index = 0; index < images.length; index += 1) {
    throwIfAborted(signal);
    const image = images[index]!;
    try {
      const preview = await createSafePreview(image, signal, allowWorkflowFallback);
      results.push({ ...image, preview, previewError: undefined });
      onStage?.(`安全预览 ${index + 1}/${images.length} 已就绪。`);
    } catch (error) {
      if (isAbortError(error)) throw error;
      const previewError = error instanceof Error ? error.message : String(error);
      results.push({ ...image, preview: undefined, previewError });
      onStage?.(`安全预览 ${index + 1}/${images.length} 失败；仍可点击候选并回填原图：${previewError}`);
    }
  }
  return results;
}

export async function loadHolopixSafePreviewsForImages(
  images: AiGeneratedImage[],
  signal?: AbortSignal,
  onStage?: (message: string) => void
): Promise<AiGeneratedImage[]> {
  return loadSafePreviews(images, signal, onStage);
}

export async function loadHolopixDirectPreviewsForImages(
  images: AiGeneratedImage[],
  signal?: AbortSignal,
  onStage?: (message: string) => void
): Promise<AiGeneratedImage[]> {
  return loadSafePreviews(images, signal, onStage, false);
}

async function createSafePreview(
  image: AiGeneratedImage,
  signal?: AbortSignal,
  allowWorkflowFallback = true
) {
  let directError = "";
  try {
    const directResponse = await fetchBinary(
      buildHolopixSafeJpegUrl(image, COMFY_BASE_URL),
      signal,
      20_000,
      HOLOPIX_DIRECT_PREVIEW_MAX_BYTES
    );
    return decodeHolopixDirectJpeg(directResponse.bytes, directResponse.mediaType);
  } catch (error) {
    if (isAbortError(error)) throw error;
    directError = error instanceof Error ? error.message : String(error);
  }
  if (!allowWorkflowFallback) {
    throw new Error(`直读 JPEG 预览失败：${directError}`);
  }

  const prepared = prepareHolopixSafePreviewWorkflow(image);
  try {
    const queuedPrompt = await queuePrompt(prepared.workflow, signal);
    let previewImage: AiGeneratedImage;
    try {
      previewImage = await waitForPreviewImage(
        queuedPrompt.promptId,
        prepared.previewNodeId,
        30,
        signal
      );
    } finally {
      queuedPrompt.stopStatusMonitor();
    }
    const response = await fetchBinary(
      buildHolopixSafeJpegUrl(previewImage, COMFY_BASE_URL),
      signal,
      20_000
    );
    return decodeHolopixSafeJpeg(response.bytes, response.mediaType);
  } catch (error) {
    if (isAbortError(error)) throw error;
    const fallbackError = error instanceof Error ? error.message : String(error);
    throw new Error(
      `直读 JPEG 预览失败：${directError}；本地缩放工作流兜底失败：${fallbackError}`
    );
  }
}

export async function loadHolopixPromptSource(): Promise<HolopixPromptSource> {
  return describeHolopixPromptSource(await loadBundledHolopixWorkflow());
}

async function loadBundledHolopixWorkflow(): Promise<ComfyWorkflow> {
  workflowPromise ??= (async () => {
    const provider = storage.localFileSystem;
    if (!provider.getPluginFolder) throw new Error("当前 UXP 不支持读取插件目录中的 Holopix.json。");
    const folder = await provider.getPluginFolder();
    if (!folder.getEntry) throw new Error("当前 UXP 不支持读取 Holopix.json。");
    const entry = await folder.getEntry("Holopix.json");
    if (!entry.isFile) throw new Error("插件目录中的 Holopix.json 不是文件。");
    const raw = await (entry as storage.File).read({ format: storage.formats.utf8 });
    if (typeof raw !== "string") throw new Error("Holopix.json 未按 UTF-8 文本读取。");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`Holopix.json 解析失败：${error instanceof Error ? error.message : String(error)}`);
    }
    assertHolopixWorkflow(parsed);
    return parsed;
  })();
  return workflowPromise;
}

async function uploadReference(
  options: HolopixReferenceGenerationOptions,
  signal?: AbortSignal
): Promise<UploadedImage> {
  const copy = new Uint8Array(options.referenceBytes.byteLength);
  copy.set(options.referenceBytes);
  const form = new FormData();
  form.append("image", new Blob([copy.buffer], { type: options.referenceMediaType }), options.referenceFileName);
  form.append("overwrite", "true");
  const response = await fetchJson(`${COMFY_BASE_URL}/upload/image`, {
    method: "POST",
    body: form,
    signal
  }, 45_000) as UploadedImage;
  if (!response?.name) throw new Error("ComfyUI 上传参考图后未返回文件名。");
  return response;
}

async function queuePrompt(
  workflow: ComfyWorkflow,
  signal?: AbortSignal,
  onExecutionStatus?: (message: string) => void
): Promise<QueuedComfyPrompt> {
  const clientId = `chess-go-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const monitor = createComfyPromptStatusMonitor(
    clientId,
    workflow,
    signal,
    onExecutionStatus
  );
  try {
    const response = await fetchJson(`${COMFY_BASE_URL}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: clientId }),
      signal
    }, 30_000) as QueueResponse;
    if (response.error) throw new Error(`ComfyUI 拒绝工作流：${response.error}`);
    if (response.node_errors && Object.keys(response.node_errors).length) {
      throw new Error(`ComfyUI 节点校验失败：${JSON.stringify(response.node_errors)}`);
    }
    if (!response.prompt_id) throw new Error("ComfyUI 未返回 prompt_id。");
    monitor.start(response.prompt_id);
    return { promptId: response.prompt_id, stopStatusMonitor: monitor.stop };
  } catch (error) {
    monitor.stop();
    throw error;
  }
}

export async function queueComfyWorkflow(
  workflow: ComfyWorkflow,
  signal?: AbortSignal,
  onExecutionStatus?: (message: string) => void
): Promise<QueuedComfyPrompt> {
  return queuePrompt(workflow, signal, onExecutionStatus);
}

function createComfyPromptStatusMonitor(
  clientId: string,
  workflow: ComfyWorkflow,
  externalSignal?: AbortSignal,
  onExecutionStatus?: (message: string) => void
): ComfyPromptStatusMonitor {
  if (!onExecutionStatus) return { start: () => undefined, stop: () => undefined };

  let stopped = false;
  let promptId: string | undefined;
  let socket: WebSocket | null = null;
  let reconnectTimer: number | undefined;
  let hasSocketExecutionStatus = false;
  let lastStatus = "";
  const monitorController = new AbortController();
  const report = (message: string): void => {
    if (stopped || message === lastStatus) return;
    lastStatus = message;
    onExecutionStatus(message);
  };

  const connectSocket = (): void => {
    if (stopped || typeof globalThis.WebSocket !== "function") return;
    try {
      const socketUrl = `${COMFY_BASE_URL.replace(/^http/i, "ws")}/ws?clientId=${encodeURIComponent(clientId)}`;
      const nextSocket = new globalThis.WebSocket(socketUrl);
      socket = nextSocket;
      nextSocket.onmessage = (event): void => {
        if (stopped || typeof event.data !== "string") return;
        let parsed: unknown;
        try {
          parsed = JSON.parse(event.data);
        } catch {
          return;
        }
        const status = describeComfyExecutionMessage(parsed, promptId, workflow);
        if (!status) return;
        hasSocketExecutionStatus = true;
        report(status.text);
      };
      nextSocket.onerror = (): void => undefined;
      nextSocket.onclose = (): void => {
        if (socket === nextSocket) socket = null;
        hasSocketExecutionStatus = false;
        if (!stopped) reconnectTimer = window.setTimeout(connectSocket, 1000);
      };
    } catch {
      socket = null;
    }
  };

  const pollQueue = async (): Promise<void> => {
    while (!stopped && promptId) {
      try {
        const queue = await fetchJson(
          `${COMFY_BASE_URL}/queue`,
          { signal: monitorController.signal },
          6000
        );
        const status = describeComfyQueueStatus(queue, promptId);
        if (status?.kind === "queued") {
          hasSocketExecutionStatus = false;
          report(status.text);
        } else if (status?.kind === "running" && !hasSocketExecutionStatus) {
          report(status.text);
        }
      } catch {
        if (stopped || monitorController.signal.aborted) return;
      }
      try {
        await delay(800, monitorController.signal);
      } catch {
        return;
      }
    }
  };

  const abortFromExternal = (): void => stop();
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    monitorController.abort();
    if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
    const activeSocket = socket;
    socket = null;
    if (activeSocket && activeSocket.readyState < 2) activeSocket.close();
    externalSignal?.removeEventListener("abort", abortFromExternal);
  };
  const start = (nextPromptId: string): void => {
    if (stopped) return;
    promptId = nextPromptId;
    report("ComfyUI 已提交 · 正在查询队列");
    void pollQueue();
  };

  externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  if (externalSignal?.aborted) stop();
  else connectSocket();
  return { start, stop };
}

async function waitForImages(
  promptId: string,
  saveNodeId: string,
  promptCaptureNodeId: string,
  expectedImageCount: number,
  timeoutSeconds: number,
  signal?: AbortSignal
): Promise<{
  images: AiGeneratedImage[];
  promptText?: string;
  terminalError?: string;
}> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    let history: Record<string, HolopixHistoryEntry>;
    try {
      history = await fetchJson(
        `${COMFY_BASE_URL}/history/${encodeURIComponent(promptId)}`,
        { signal },
        12_000
      ) as Record<string, HolopixHistoryEntry>;
    } catch (error) {
      if (isAbortError(error)) throw error;
      await delay(1200, signal);
      continue;
    }
    const entry = history[promptId];
    if (entry) {
      const decision = interpretHolopixHistoryEntry(
        entry,
        saveNodeId,
        promptCaptureNodeId,
        expectedImageCount
      );
      if (decision.kind === "failed") throw new Error(decision.error);
      if (decision.kind === "complete") {
        return {
          images: decision.images.map(toGeneratedImage),
          ...(decision.promptText ? { promptText: decision.promptText } : {}),
          ...(decision.terminalError ? { terminalError: decision.terminalError } : {})
        };
      }
    }
    await delay(1000, signal);
  }
  throw new HolopixGenerationOutcomeUnknownError(
    `等待 Holopix 生成超时（${timeoutSeconds} 秒）；任务结果尚未确认，已禁止直接重试。`,
    { promptId }
  );
}

function summarizePrompt(promptText: string): string {
  const compact = promptText.replace(/\s+/g, " ").trim();
  return compact.length > 120 ? `${compact.slice(0, 120)}…` : compact;
}

async function waitForPreviewImage(
  promptId: string,
  previewNodeId: string,
  timeoutSeconds: number,
  signal?: AbortSignal
): Promise<AiGeneratedImage> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    let history: Record<string, HolopixHistoryEntry>;
    try {
      history = await fetchJson(
        `${COMFY_BASE_URL}/history/${encodeURIComponent(promptId)}`,
        { signal },
        12_000
      ) as Record<string, HolopixHistoryEntry>;
    } catch (error) {
      if (isAbortError(error)) throw error;
      await delay(400, signal);
      continue;
    }
    const entry = history[promptId];
    if (entry) {
      const executionError = findHolopixExecutionError(entry.status?.messages);
      if (executionError) throw new Error(executionError);
      const image = entry.outputs?.[previewNodeId]?.images?.[0];
      if (image) return toGeneratedImage(image);
      if (entry.status?.completed || entry.status?.status_str === "error") {
        throw new Error("ComfyUI 安全缩略图工作流已结束，但没有输出图片。");
      }
    }
    await delay(400, signal);
  }
  throw new Error(`等待 ComfyUI 安全缩略图超时（${timeoutSeconds} 秒）。`);
}

function toGeneratedImage(image: HolopixHistoryImage): AiGeneratedImage {
  if (!image.filename) throw new Error("ComfyUI 返回了缺少 filename 的图片记录。");
  const subfolder = image.subfolder ?? "";
  const type = image.type ?? "output";
  const query = new URLSearchParams({ filename: image.filename, subfolder, type });
  return {
    filename: image.filename,
    subfolder,
    type,
    url: `${COMFY_BASE_URL}/view?${query.toString()}`
  };
}

async function fetchJson(url: string, init?: RequestInit, timeoutMs = 15_000): Promise<unknown> {
  let response: Response;
  let text: string;
  const controller = new AbortController();
  const externalSignal = init?.signal;
  const abortFromExternal = (): void => controller.abort();
  externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
    text = await response.text();
  } catch (error) {
    if (externalSignal?.aborted) throw abortError();
    if (controller.signal.aborted) throw new Error(`连接局域网 ComfyUI 超时（${Math.round(timeoutMs / 1000)} 秒）。`);
    throw new Error(`无法连接局域网 ComfyUI（${COMFY_BASE_URL}）：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    window.clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { detail: text.slice(0, 500) };
    }
  }
  if (!response.ok) {
    const detail = typeof data === "object" && data
      ? JSON.stringify(data)
      : String(data);
    throw new Error(`ComfyUI HTTP ${response.status}：${detail}`);
  }
  return data;
}

export async function fetchComfyJson(
  url: string,
  init?: RequestInit,
  timeoutMs = 15_000
): Promise<unknown> {
  return fetchJson(url, init, timeoutMs);
}

async function fetchBinary(
  url: string,
  signal?: AbortSignal,
  timeoutMs = 15_000,
  maxBytes = HOLOPIX_SAFE_PREVIEW_MAX_BYTES
): Promise<{ bytes: Uint8Array; mediaType: string | null }> {
  const controller = new AbortController();
  const abortFromExternal = (): void => controller.abort();
  signal?.addEventListener("abort", abortFromExternal, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`ComfyUI HTTP ${response.status}。`);
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > maxBytes) {
      throw new Error(`Holopix 安全缩略图超过上限（${Math.ceil(contentLength / 1024)} KiB）。`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.byteLength > maxBytes) {
      throw new Error(`Holopix 安全缩略图超过上限（${Math.ceil(bytes.byteLength / 1024)} KiB）。`);
    }
    return { bytes, mediaType: response.headers.get("content-type") };
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (controller.signal.aborted) throw new Error("读取 Holopix 安全缩略图超时。");
    throw new Error(`读取 Holopix 安全缩略图失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromExternal);
  }
}

function makeRequestNonce(batchIndex: number): number {
  const base = Date.now() % 2_000_000_000;
  return base + batchIndex;
}

function safePathSegment(value: string): string {
  return value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 80) || "unnamed";
}

function notifySubmissionLifecycle(
  options: HolopixGenerationOptions,
  event: HolopixSubmissionLifecycleEvent
): void {
  notifyHolopixSubmissionLifecycle(options.onSubmissionLifecycle, event, options.onStage);
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = window.setTimeout(resolve, milliseconds);
    signal?.addEventListener("abort", () => {
      window.clearTimeout(timer);
      reject(abortError());
    }, { once: true });
  });
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortError();
}

function abortError(): Error {
  const error = new Error("已停止等待 Holopix 任务；已提交到 ComfyUI 的任务可能仍在后台完成。");
  error.name = "AbortError";
  return error;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function isHolopixAbortError(error: unknown): boolean {
  return isAbortError(error);
}
