import { storage } from "uxp";
import type { AiGeneratedImage } from "../domain/aiCandidates";
import { COMFY_BASE_URL } from "./holopixEndpoint";
import {
  HolopixGenerationOutcomeUnknownError,
  isAmbiguousSubmissionTransportError
} from "./holopixErrors";
import { findHolopixExecutionError, type HolopixHistoryEntry } from "./holopixGenerationResult";
import {
  checkHolopixAvailability,
  fetchComfyJson,
  isHolopixAbortError,
  loadHolopixSafePreviewsForImages,
  queueComfyWorkflow
} from "./holopixClient";
import {
  collectGptImage2ImagesForPromptId,
  collectRecentGptImage2Images
} from "./gptImage2Recovery";
import {
  assertGptImage2Workflow,
  prepareGptImage2Workflow,
  safeGptImage2OutputName,
  type GptImage2WorkflowItem
} from "./gptImage2Workflow";
import type { ComfyWorkflow } from "./holopixWorkflow";
import {
  notifyHolopixSubmissionLifecycle,
  type HolopixSubmissionLifecycleEvent
} from "./holopixSubmissionLifecycle";

let workflowPromise: Promise<ComfyWorkflow> | null = null;

export interface GptImage2ChainItem extends GptImage2WorkflowItem {}

export interface GptImage2ChainGenerationOptions {
  items: GptImage2ChainItem[];
  signal?: AbortSignal;
  onStage?: (message: string) => void;
  onBeforeSubmit?: () => void | Promise<void>;
  onSubmissionLifecycle?: (event: HolopixSubmissionLifecycleEvent) => void;
  onImagesReady?: (
    imagesByAssetCode: Record<string, AiGeneratedImage>,
    submission: GptImage2CompletedSubmission
  ) => void;
}

export interface GptImage2CompletedSubmission {
  key: string;
  promptId: string;
}

export interface GptImage2GenerationResult extends GptImage2CompletedSubmission {
  imagesByAssetCode: Record<string, AiGeneratedImage>;
}

export interface GptImage2PendingSubmission {
  promptId: string;
  assetCode: string;
}

export interface GptImage2RecoveryResult {
  recentByAssetCode: Record<string, AiGeneratedImage[]>;
  byPromptId: Record<string, Record<string, AiGeneratedImage[]>>;
}

export async function generateGptImage2Chain(
  options: GptImage2ChainGenerationOptions
): Promise<GptImage2GenerationResult> {
  const baseWorkflow = await loadBundledGptImage2Workflow();
  await checkHolopixAvailability(options.signal);
  const requestNonce = makeRequestNonce();
  const submissionKey = `gpt-image-2:${requestNonce}`;
  const prepared = prepareGptImage2Workflow(baseWorkflow, {
    items: options.items,
    requestNonce,
    confirmCost: true,
    outputSubfolder: `Holopix/ChessGo/GptImage2/${requestNonce}`
  });
  options.onStage?.(
    `使用 GptImage2.json 内置风格参考；本轮将一次生成并拆分 ${options.items.length} 个物品。`
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

  let promptId: string;
  try {
    promptId = await queueComfyWorkflow(prepared.workflow, options.signal);
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
      "GPT Image 2 整链提交响应未确认；任务可能已经进入 ComfyUI，已禁止直接重试。",
      { submissionKey }
    );
  }
  const submission = { key: submissionKey, promptId };
  notifyHolopixSubmissionLifecycle(options.onSubmissionLifecycle, {
    state: "confirmed",
    ...submissionEvent,
    promptId
  }, options.onStage);
  options.onStage?.(`GPT Image 2 整链已提交（${options.items.length} 个物品）。`);

  let rawImages: AiGeneratedImage[];
  try {
    rawImages = await waitForGptImage2Images(
      promptId,
      prepared.saveNodeId,
      prepared.timeoutSeconds + 90,
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
      "GPT Image 2 整链已提交，但等待结果时被中止；任务可能仍在 ComfyUI 后台运行。",
      { promptId, submissionKey }
    );
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
      `GPT Image 2 整链请求 ${options.items.length} 个物品，但只拆分出 `
      + `${Object.keys(completedByAssetCode).length} 个；已有结果已保留。`
    );
  }
  return { ...submission, imagesByAssetCode: completedByAssetCode };
}

export async function recoverRecentGptImage2Images(
  items: Array<{ assetCode: string; itemName: string }>,
  maxCandidates: number,
  signal?: AbortSignal,
  onStage?: (message: string) => void,
  pendingSubmissions: GptImage2PendingSubmission[] = []
): Promise<GptImage2RecoveryResult> {
  const byPromptId: GptImage2RecoveryResult["byPromptId"] = {};
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
        const images = collectGptImage2ImagesForPromptId(history, promptId, assetCode, COMFY_BASE_URL);
        byPromptId[promptId]![assetCode] = await loadHolopixSafePreviewsForImages(
          images,
          signal,
          (message) => onStage?.(`${assetCode}（提交 ${promptId}）：${message}`)
        );
      }
    } catch (error) {
      if (isHolopixAbortError(error)) throw error;
      for (const assetCode of assetCodes) byPromptId[promptId]![assetCode] = [];
      onStage?.(`GPT Image 2 待确认提交 ${promptId} 暂时无法精确恢复。`);
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
    const recovered = collectRecentGptImage2Images(history, assetCodes, COMFY_BASE_URL);
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
    onStage?.(`GPT Image 2 宽泛历史恢复暂时不可用：${error instanceof Error ? error.message : String(error)}`);
  }
  return { recentByAssetCode, byPromptId };
}

async function loadBundledGptImage2Workflow(): Promise<ComfyWorkflow> {
  workflowPromise ??= (async () => {
    const provider = storage.localFileSystem;
    if (!provider.getPluginFolder) throw new Error("当前 UXP 不支持读取插件目录中的 GptImage2.json。");
    const folder = await provider.getPluginFolder();
    if (!folder.getEntry) throw new Error("当前 UXP 不支持读取 GptImage2.json。");
    const entry = await folder.getEntry("GptImage2.json");
    if (!entry.isFile) throw new Error("插件目录中的 GptImage2.json 不是文件。");
    const raw = await (entry as storage.File).read({ format: storage.formats.utf8 });
    if (typeof raw !== "string") throw new Error("GptImage2.json 未按 UTF-8 文本读取。");
    const parsed = JSON.parse(raw) as unknown;
    assertGptImage2Workflow(parsed);
    return parsed;
  })();
  return workflowPromise;
}

async function waitForGptImage2Images(
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
        if (!images.length) throw new Error("GPT Image 2 整链已结束，但保存节点没有输出候选图。");
        return images.map(toGeneratedImage);
      }
    }
    await delay(1000, signal);
  }
  throw new HolopixGenerationOutcomeUnknownError(
    `等待 GPT Image 2 整链超时（${timeoutSeconds} 秒）；任务结果尚未确认。`,
    { promptId }
  );
}

function mapImagesToItems(
  images: AiGeneratedImage[],
  items: GptImage2ChainItem[]
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
  if (!image.filename) throw new Error("ComfyUI 返回了缺少 filename 的 GPT Image 2 图片记录。");
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

function makeRequestNonce(): number {
  return Date.now() % 2_000_000_000;
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
  const error = new Error("已停止等待 GPT Image 2 整链；已提交任务可能仍在后台完成。");
  error.name = "AbortError";
  return error;
}
