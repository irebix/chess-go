import { storage } from "uxp";
import type { AiGeneratedImage } from "../domain/aiCandidates";
import type {
  GptImage2ChainGenerationOptions,
  GptImage2GenerationResult,
  GptImage2PendingSubmission,
  GptImage2RecoveryResult
} from "./gptImage2Client";
import {
  collectGPlusFImagesForPromptId,
  collectRecentGPlusFImages,
  G_PLUS_F_OUTPUT_ROOT
} from "./gPlusFRecovery";
import {
  assertGPlusFWorkflow,
  G_PLUS_F_NODE_TITLES,
  prepareGPlusFWorkflow
} from "./gPlusFWorkflow";
import {
  HolopixGenerationOutcomeUnknownError,
  isAmbiguousSubmissionTransportError
} from "./holopixErrors";
import { COMFY_BASE_URL } from "./holopixEndpoint";
import { findHolopixExecutionError, type HolopixHistoryEntry } from "./holopixGenerationResult";
import {
  checkHolopixAvailability,
  fetchComfyJson,
  isHolopixAbortError,
  loadHolopixSafePreviewsForImages,
  queueComfyWorkflow
} from "./holopixClient";
import {
  notifyHolopixSubmissionLifecycle
} from "./holopixSubmissionLifecycle";
import {
  assertHolopixWorkflow,
  type ComfyWorkflow
} from "./holopixWorkflow";
import { safeGptImage2OutputName } from "./gptImage2Workflow";

export const G_PLUS_F_STYLE_ASSET = "ImageRefinerStyle.png";
export const G_PLUS_F_REFERENCE_UPLOAD_TIMEOUT_RESERVE_SECONDS = 90;

type GPlusFGenerationOptions = GptImage2ChainGenerationOptions;
type GPlusFGenerationResult = GptImage2GenerationResult;
type GPlusFPendingSubmission = GptImage2PendingSubmission;
type GPlusFRecoveryResult = GptImage2RecoveryResult;

interface GPlusFBundledResources {
  workflow: ComfyWorkflow;
  holopixSourceWorkflow: ComfyWorkflow;
  styleReference: Uint8Array;
}

interface UploadedInput {
  name?: string;
  subfolder?: string;
}

let bundledResourcesPromise: Promise<GPlusFBundledResources> | null = null;

export async function generateGPlusFChain(
  options: GPlusFGenerationOptions
): Promise<GPlusFGenerationResult> {
  const resources = await loadBundledResources();
  await checkHolopixAvailability(options.signal);
  const { gptRequestNonce, holopixRequestNonce } = gPlusFRequestNonces();
  const uploadedStylePath = await uploadBundledStyleReference(
    resources.styleReference,
    gptRequestNonce,
    options.signal
  );
  const submissionKey = `g-plus-f:${gptRequestNonce}:${holopixRequestNonce}`;
  const prepared = prepareGPlusFWorkflow(resources.workflow, {
    items: options.items,
    gptRequestNonce,
    holopixRequestNonce,
    outputSubfolder: `${G_PLUS_F_OUTPUT_ROOT}/${gptRequestNonce}`
  }, resources.holopixSourceWorkflow);
  bindGPlusFStyleReference(prepared.workflow, uploadedStylePath);
  const estimatedCostPoints = gPlusFEstimatedCostPoints(options.items.length);
  options.onStage?.(
    `已确保 ${G_PLUS_F_STYLE_ASSET} 上传；GPT Image 2 将先生成整张初稿并裁切为 `
      + `${options.items.length} 张，每张裁切图再独立上传为真实参考图，以 0.2 权重`
      + `串行交给 Holopix 逐图细化。预计消耗 ${estimatedCostPoints} 积分`
      + `（35 + 3 × ${options.items.length}）。`
  );
  await options.onBeforeSubmit?.();
  const submissionEvent = {
    submissionKey,
    completedBeforeBatch: 0,
    batchSize: 1,
    createdAt: Date.now(),
    promptText: prepared.promptText
  };
  notifyHolopixSubmissionLifecycle(options.onSubmissionLifecycle, {
    state: "started",
    ...submissionEvent
  }, options.onStage);

  let queuedPrompt: Awaited<ReturnType<typeof queueComfyWorkflow>>;
  let promptId: string;
  try {
    queuedPrompt = await queueComfyWorkflow(
      prepared.workflow,
      options.signal,
      options.onExecutionStatus
    );
    promptId = queuedPrompt.promptId;
  } catch (error) {
    if (!isAmbiguousSubmissionTransportError(error)) {
      notifyHolopixSubmissionLifecycle(options.onSubmissionLifecycle, {
        state: "resolved",
        ...submissionEvent,
        outcome: "failed"
      }, options.onStage);
      throw error;
    }
    throw new HolopixGenerationOutcomeUnknownError(
      "G+F 逐图细化链提交响应未确认；任务可能已经进入 ComfyUI，已禁止直接重试。",
      { submissionKey }
    );
  }
  const submission = { key: submissionKey, promptId };
  notifyHolopixSubmissionLifecycle(options.onSubmissionLifecycle, {
    state: "confirmed",
    ...submissionEvent,
    promptId
  }, options.onStage);
  options.onStage?.(
    `G+F 逐图细化链已提交（GPT 整图裁切后串行细化 ${options.items.length} 张，`
      + `预计 ${estimatedCostPoints} 积分）。`
  );

  let rawImages: AiGeneratedImage[];
  try {
    rawImages = await waitForGPlusFImages(
      promptId,
      prepared.saveNodeId,
      gPlusFResultTimeoutSeconds(prepared.timeoutSeconds, options.items.length),
      options.signal
    );
  } catch (error) {
    if (error instanceof HolopixGenerationOutcomeUnknownError) {
      throw new HolopixGenerationOutcomeUnknownError(error.message, {
        promptId: error.promptId ?? promptId,
        submissionKey: error.submissionKey ?? submissionKey
      });
    }
    if (!isHolopixAbortError(error)) {
      notifyHolopixSubmissionLifecycle(options.onSubmissionLifecycle, {
        state: "resolved",
        ...submissionEvent,
        promptId,
        outcome: "failed"
      }, options.onStage);
      throw error;
    }
    throw new HolopixGenerationOutcomeUnknownError(
      "G+F 逐图细化链已提交，但等待结果时被中止；任务可能仍在 ComfyUI 后台运行。",
      { promptId, submissionKey }
    );
  } finally {
    queuedPrompt.stopStatusMonitor();
  }

  const rawByAssetCode = mapImagesToItems(rawImages, options.items);
  options.onImagesReady?.(rawByAssetCode, submission);
  notifyHolopixSubmissionLifecycle(options.onSubmissionLifecycle, {
    state: "resolved",
    ...submissionEvent,
    promptId,
    outcome: "output",
    images: Object.values(rawByAssetCode)
  }, options.onStage);
  const previewed = await loadHolopixSafePreviewsForImages(
    Object.values(rawByAssetCode),
    options.signal,
    options.onStage
  );
  const previewByKey = new Map(previewed.map((image) => [imageKey(image), image]));
  const completedByAssetCode = Object.fromEntries(Object.entries(rawByAssetCode).map(
    ([assetCode, image]) => [assetCode, previewByKey.get(imageKey(image)) ?? image]
  ));
  options.onImagesReady?.(completedByAssetCode, submission);

  if (Object.keys(completedByAssetCode).length !== options.items.length) {
    throw new Error(
      `G+F 逐图细化请求 ${options.items.length} 个物品，但只返回 `
      + `${Object.keys(completedByAssetCode).length} 个；已有结果已保留。`
    );
  }
  return { ...submission, imagesByAssetCode: completedByAssetCode };
}

export async function recoverRecentGPlusFImages(
  items: Array<{ assetCode: string; itemName: string }>,
  maxCandidates: number,
  signal?: AbortSignal,
  onStage?: (message: string) => void,
  pendingSubmissions: GPlusFPendingSubmission[] = []
): Promise<GPlusFRecoveryResult> {
  const byPromptId: GPlusFRecoveryResult["byPromptId"] = {};
  const pendingByPromptId = new Map<string, Set<string>>();
  for (const pending of pendingSubmissions) {
    const assetCodes = pendingByPromptId.get(pending.promptId) ?? new Set<string>();
    assetCodes.add(pending.assetCode);
    pendingByPromptId.set(pending.promptId, assetCodes);
  }
  for (const [promptId, assetCodes] of pendingByPromptId) {
    byPromptId[promptId] = {};
    try {
      const history = await fetchComfyJson(
        `${COMFY_BASE_URL}/history/${encodeURIComponent(promptId)}`,
        { signal },
        20_000
      ) as Record<string, HolopixHistoryEntry>;
      for (const assetCode of assetCodes) {
        const images = collectGPlusFImagesForPromptId(
          history,
          promptId,
          assetCode,
          COMFY_BASE_URL
        );
        byPromptId[promptId]![assetCode] = await loadHolopixSafePreviewsForImages(
          images,
          signal,
          (message) => onStage?.(`${assetCode}（提交 ${promptId}）：${message}`)
        );
      }
    } catch (error) {
      if (isHolopixAbortError(error)) throw error;
      for (const assetCode of assetCodes) byPromptId[promptId]![assetCode] = [];
      onStage?.(`G+F 待确认提交 ${promptId} 暂时无法精确恢复。`);
    }
  }

  const assetCodes = items.map((item) => item.assetCode);
  const recentByAssetCode = Object.fromEntries(
    assetCodes.map((assetCode) => [assetCode, [] as AiGeneratedImage[]])
  );
  try {
    const history = await fetchComfyJson(
      `${COMFY_BASE_URL}/history?max_items=1000`,
      { signal },
      20_000
    ) as Record<string, HolopixHistoryEntry>;
    const recovered = collectRecentGPlusFImages(history, assetCodes, COMFY_BASE_URL);
    for (const item of items) {
      const images = (recovered[item.assetCode] ?? []).slice(0, maxCandidates).map((image) => ({
        ...image,
        promptText: item.itemName
      }));
      recentByAssetCode[item.assetCode] = await loadHolopixSafePreviewsForImages(
        images,
        signal,
        (message) => onStage?.(`${item.assetCode}：${message}`)
      );
    }
  } catch (error) {
    if (isHolopixAbortError(error)) throw error;
    onStage?.(`G+F 宽泛历史恢复暂时不可用：${error instanceof Error ? error.message : String(error)}`);
  }
  return { recentByAssetCode, byPromptId };
}

export function gPlusFRequestNonces(now = Date.now()): {
  gptRequestNonce: number;
  holopixRequestNonce: number;
} {
  if (!Number.isFinite(now) || now < 0) {
    throw new Error("G+F request nonce 时间戳必须是非负有限数字。");
  }
  const gptRequestNonce = Math.trunc(now) % 2_000_000_000;
  return {
    gptRequestNonce,
    holopixRequestNonce: (gptRequestNonce + 1) % 2_000_000_000
  };
}

export function gPlusFEstimatedCostPoints(itemCount: number): number {
  assertGPlusFItemCount(itemCount);
  return 35 + (3 * itemCount);
}

export function gPlusFResultTimeoutSeconds(
  workflowTimeoutSeconds: number,
  itemCount: number
): number {
  assertGPlusFItemCount(itemCount);
  if (!Number.isFinite(workflowTimeoutSeconds) || workflowTimeoutSeconds <= 0) {
    throw new Error("G+F workflow 超时必须是正有限数字。");
  }
  return Math.ceil(workflowTimeoutSeconds)
    + (G_PLUS_F_REFERENCE_UPLOAD_TIMEOUT_RESERVE_SECONDS * itemCount);
}

export function gPlusFStyleUploadSubfolder(gptRequestNonce: number): string {
  if (!Number.isSafeInteger(gptRequestNonce) || gptRequestNonce < 0) {
    throw new Error("G+F 风格参考图上传目录需要非负安全整数 nonce。");
  }
  return `ChessGo/GPlusF/style/${gptRequestNonce}`;
}

export function bindGPlusFStyleReference(
  workflow: ComfyWorkflow,
  uploadedPath: string
): void {
  const normalizedPath = uploadedPath.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalizedPath || normalizedPath.split("/").includes("..")) {
    throw new Error("G+F 风格参考图的 ComfyUI 输入路径无效。");
  }
  const matches = Object.values(workflow).filter((node) => (
    node.class_type === "LoadImage"
    && node._meta?.title === G_PLUS_F_NODE_TITLES.reference
  ));
  if (matches.length !== 1) {
    throw new Error(`GPlusF.json 需要且只能包含 1 个“${G_PLUS_F_NODE_TITLES.reference}”节点。`);
  }
  matches[0]!.inputs.image = normalizedPath;
}

async function loadBundledResources(): Promise<GPlusFBundledResources> {
  bundledResourcesPromise ??= (async () => {
    const provider = storage.localFileSystem;
    if (!provider.getPluginFolder) throw new Error("当前 UXP 不支持读取 G+F 插件资源。");
    const folder = await provider.getPluginFolder();
    if (!folder.getEntry) throw new Error("当前 UXP 不支持读取 G+F 插件资源。");
    const [workflowEntry, holopixEntry, styleEntry] = await Promise.all([
      folder.getEntry("GPlusF.json"),
      folder.getEntry("Holopix.json"),
      folder.getEntry(G_PLUS_F_STYLE_ASSET)
    ]);
    if (!workflowEntry.isFile) throw new Error("插件目录中的 GPlusF.json 不是文件。");
    if (!holopixEntry.isFile) throw new Error("插件目录中的 Holopix.json 不是文件。");
    if (!styleEntry.isFile) {
      throw new Error(`插件目录中的 ${G_PLUS_F_STYLE_ASSET} 不是文件。`);
    }
    const [rawWorkflow, rawHolopixWorkflow, rawStyle] = await Promise.all([
      (workflowEntry as storage.File).read({ format: storage.formats.utf8 }),
      (holopixEntry as storage.File).read({ format: storage.formats.utf8 }),
      (styleEntry as storage.File).read({ format: storage.formats.binary })
    ]);
    if (typeof rawWorkflow !== "string") throw new Error("GPlusF.json 未按 UTF-8 文本读取。");
    if (typeof rawHolopixWorkflow !== "string") {
      throw new Error("Holopix.json 未按 UTF-8 文本读取。");
    }
    if (!(rawStyle instanceof ArrayBuffer) || !rawStyle.byteLength) {
      throw new Error(`${G_PLUS_F_STYLE_ASSET} 未按二进制图片读取。`);
    }
    let workflow: unknown;
    let holopixSourceWorkflow: unknown;
    try {
      workflow = JSON.parse(rawWorkflow);
      holopixSourceWorkflow = JSON.parse(rawHolopixWorkflow);
    } catch (error) {
      throw new Error(`G+F 工作流解析失败：${error instanceof Error ? error.message : String(error)}`);
    }
    assertHolopixWorkflow(holopixSourceWorkflow);
    assertGPlusFWorkflow(workflow, holopixSourceWorkflow);
    return {
      workflow,
      holopixSourceWorkflow,
      styleReference: new Uint8Array(rawStyle)
    };
  })();
  return bundledResourcesPromise;
}

async function uploadBundledStyleReference(
  imageBytes: Uint8Array,
  gptRequestNonce: number,
  signal?: AbortSignal
): Promise<string> {
  const copy = imageBytes.buffer.slice(
    imageBytes.byteOffset,
    imageBytes.byteOffset + imageBytes.byteLength
  ) as ArrayBuffer;
  const form = new FormData();
  form.append("image", new Blob([copy], { type: "image/png" }), G_PLUS_F_STYLE_ASSET);
  form.append("subfolder", gPlusFStyleUploadSubfolder(gptRequestNonce));
  form.append("type", "input");
  form.append("overwrite", "true");
  const response = await fetchComfyJson(`${COMFY_BASE_URL}/upload/image`, {
    method: "POST",
    body: form,
    signal
  }, 60_000) as UploadedInput;
  if (!response?.name) throw new Error("ComfyUI 上传 G+F 风格参考图后未返回文件名。");
  const subfolder = response.subfolder?.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  return subfolder ? `${subfolder}/${response.name}` : response.name;
}

async function waitForGPlusFImages(
  promptId: string,
  saveNodeId: string,
  timeoutSeconds: number,
  signal?: AbortSignal
): Promise<AiGeneratedImage[]> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    if (signal?.aborted) throw abortError();
    let history: Record<string, HolopixHistoryEntry>;
    try {
      history = await fetchComfyJson(
        `${COMFY_BASE_URL}/history/${encodeURIComponent(promptId)}`,
        { signal },
        12_000
      ) as Record<string, HolopixHistoryEntry>;
    } catch (error) {
      if (isHolopixAbortError(error)) throw error;
      await delay(1000, signal);
      continue;
    }
    const entry = history[promptId];
    if (entry) {
      const executionError = findHolopixExecutionError(entry.status?.messages);
      if (executionError) throw new Error(executionError);
      const images = entry.outputs?.[saveNodeId]?.images ?? [];
      if (entry.status?.completed || entry.status?.status_str === "error") {
        if (!images.length) throw new Error("G+F 逐图细化链已结束，但保存节点没有输出候选图。");
        return images.map(toGeneratedImage);
      }
    }
    await delay(1000, signal);
  }
  throw new HolopixGenerationOutcomeUnknownError(
    `等待 G+F 逐图细化链超时（${timeoutSeconds} 秒）；任务结果尚未确认。`,
    { promptId }
  );
}

function assertGPlusFItemCount(itemCount: number): void {
  if (!Number.isSafeInteger(itemCount) || itemCount <= 0) {
    throw new Error("G+F 物品数必须是正安全整数。");
  }
}

function mapImagesToItems(
  images: AiGeneratedImage[],
  items: GPlusFGenerationOptions["items"]
): Record<string, AiGeneratedImage> {
  const unused = [...images];
  const mapped: Record<string, AiGeneratedImage> = {};
  for (const item of items) {
    const safeName = safeGptImage2OutputName(item.assetCode).toLowerCase();
    const index = unused.findIndex((image) => (
      image.filename.toLowerCase() === `${safeName}.png`
      || image.filename.toLowerCase().startsWith(`${safeName}__run`)
    ));
    if (index < 0) continue;
    const [image] = unused.splice(index, 1);
    mapped[item.assetCode] = {
      ...image!,
      promptText: item.promptText?.trim() || item.itemName.trim() || item.assetCode
    };
  }
  return mapped;
}

function toGeneratedImage(image: { filename?: string; subfolder?: string; type?: string }): AiGeneratedImage {
  if (!image.filename) throw new Error("ComfyUI 返回了缺少 filename 的 G+F 图片记录。");
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

function imageKey(image: AiGeneratedImage): string {
  return `${image.type}:${image.subfolder}:${image.filename}`;
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

function abortError(): Error {
  const error = new Error("已停止等待 G+F 逐图细化链；已提交任务可能仍在后台完成。");
  error.name = "AbortError";
  return error;
}
