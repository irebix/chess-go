import { storage } from "uxp";
import type { AiGeneratedImage } from "../domain/aiCandidates";
import { buildHolopixPreviewUrl, encodeHolopixPreviewDataUrl } from "./holopixPreview";
import {
  assertHolopixWorkflow,
  describeHolopixPromptSource,
  prepareHolopixWorkflow,
  splitHolopixBatches,
  type ComfyWorkflow,
  type HolopixPromptSource
} from "./holopixWorkflow";

const DEFAULT_COMFY_URL = "http://127.0.0.1:8188";
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

interface HistoryImage {
  filename?: string;
  subfolder?: string;
  type?: string;
}

interface HistoryEntry {
  outputs?: Record<string, { images?: HistoryImage[] }>;
  status?: {
    completed?: boolean;
    status_str?: string;
    messages?: unknown[];
  };
}

export interface HolopixGenerationOptions {
  referenceBytes: Uint8Array;
  referenceFileName: string;
  referenceMediaType: string;
  candidateCount: number;
  assetCode: string;
  signal?: AbortSignal;
  onBatchStarted?: (completedCandidates: number, totalCandidates: number) => void;
  onStage?: (message: string) => void;
}

export async function checkHolopixAvailability(signal?: AbortSignal): Promise<void> {
  await fetchJson(`${DEFAULT_COMFY_URL}/system_stats`, { signal }, 10_000);
}

export async function generateHolopixImages(
  options: HolopixGenerationOptions
): Promise<AiGeneratedImage[]> {
  const baseWorkflow = await loadBundledHolopixWorkflow();
  await checkHolopixAvailability(options.signal);
  const uploaded = await uploadReference(options, options.signal);
  options.onStage?.("参考图已上传到 ComfyUI。");
  const batches = splitHolopixBatches(options.candidateCount);
  const results: AiGeneratedImage[] = [];

  for (let batchIndex = 0; batchIndex < batches.length; batchIndex += 1) {
    throwIfAborted(options.signal);
    const batchSize = batches[batchIndex]!;
    options.onBatchStarted?.(results.length, options.candidateCount);
    const prepared = prepareHolopixWorkflow(baseWorkflow, {
      imageName: uploaded.subfolder ? `${uploaded.subfolder}/${uploaded.name}` : uploaded.name,
      batchSize,
      requestNonce: makeRequestNonce(batchIndex),
      confirmCost: true,
      filenamePrefix: `Holopix/ChessGo/${safePathSegment(options.assetCode)}`
    });
    const promptId = await queuePrompt(prepared.workflow, options.signal);
    options.onStage?.(`Holopix 批次 ${batchIndex + 1}/${batches.length} 已提交。`);
    const images = await waitForImages(
      promptId,
      prepared.saveNodeId,
      prepared.timeoutSeconds + 45,
      options.signal
    );
    if (images.length < batchSize) {
      throw new Error(`Holopix 本批请求 ${batchSize} 张，但 ComfyUI 只返回 ${images.length} 张。`);
    }
    const selectedImages = images.slice(0, batchSize);
    options.onStage?.(`Holopix 批次 ${batchIndex + 1}/${batches.length} 已返回 ${selectedImages.length} 张原图。`);
    results.push(...await loadSafePreviews(selectedImages, options));
  }

  return results;
}

async function loadSafePreviews(
  images: AiGeneratedImage[],
  options: Pick<HolopixGenerationOptions, "signal" | "onStage">
): Promise<AiGeneratedImage[]> {
  const results: AiGeneratedImage[] = [];
  for (let index = 0; index < images.length; index += 1) {
    throwIfAborted(options.signal);
    const image = images[index]!;
    try {
      const previewDataUrl = await fetchPreviewDataUrl(image, options.signal);
      results.push({ ...image, previewDataUrl });
      options.onStage?.(`安全缩略图 ${index + 1}/${images.length} 已读取。`);
    } catch (error) {
      if (isAbortError(error)) throw error;
      const previewError = error instanceof Error ? error.message : String(error);
      results.push({ ...image, previewError });
      options.onStage?.(`安全缩略图 ${index + 1}/${images.length} 读取失败；原图仍可回填：${previewError}`);
    }
  }
  return results;
}

async function fetchPreviewDataUrl(
  image: AiGeneratedImage,
  signal?: AbortSignal
): Promise<string> {
  const controller = new AbortController();
  const abortFromExternal = (): void => controller.abort();
  signal?.addEventListener("abort", abortFromExternal, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(buildHolopixPreviewUrl(image, DEFAULT_COMFY_URL), {
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}。`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    return encodeHolopixPreviewDataUrl(bytes, response.headers.get("content-type"));
  } catch (error) {
    if (signal?.aborted) throw abortError();
    if (controller.signal.aborted) throw new Error("读取 Holopix 安全缩略图超时。");
    throw new Error(`读取 Holopix 安全缩略图失败：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", abortFromExternal);
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
  options: Pick<HolopixGenerationOptions, "referenceBytes" | "referenceFileName" | "referenceMediaType">,
  signal?: AbortSignal
): Promise<UploadedImage> {
  const copy = new Uint8Array(options.referenceBytes.byteLength);
  copy.set(options.referenceBytes);
  const form = new FormData();
  form.append("image", new Blob([copy.buffer], { type: options.referenceMediaType }), options.referenceFileName);
  form.append("overwrite", "true");
  const response = await fetchJson(`${DEFAULT_COMFY_URL}/upload/image`, {
    method: "POST",
    body: form,
    signal
  }, 45_000) as UploadedImage;
  if (!response?.name) throw new Error("ComfyUI 上传参考图后未返回文件名。");
  return response;
}

async function queuePrompt(workflow: ComfyWorkflow, signal?: AbortSignal): Promise<string> {
  const response = await fetchJson(`${DEFAULT_COMFY_URL}/prompt`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: workflow,
      client_id: `chess-go-${Date.now()}-${Math.random().toString(16).slice(2)}`
    }),
    signal
  }, 30_000) as QueueResponse;
  if (response.error) throw new Error(`ComfyUI 拒绝工作流：${response.error}`);
  if (response.node_errors && Object.keys(response.node_errors).length) {
    throw new Error(`ComfyUI 节点校验失败：${JSON.stringify(response.node_errors)}`);
  }
  if (!response.prompt_id) throw new Error("ComfyUI 未返回 prompt_id。");
  return response.prompt_id;
}

async function waitForImages(
  promptId: string,
  saveNodeId: string,
  timeoutSeconds: number,
  signal?: AbortSignal
): Promise<AiGeneratedImage[]> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    let history: Record<string, HistoryEntry>;
    try {
      history = await fetchJson(
        `${DEFAULT_COMFY_URL}/history/${encodeURIComponent(promptId)}`,
        { signal },
        12_000
      ) as Record<string, HistoryEntry>;
    } catch (error) {
      if (isAbortError(error)) throw error;
      await delay(1200, signal);
      continue;
    }
    const entry = history[promptId];
    if (entry) {
      const executionError = findExecutionError(entry.status?.messages);
      if (executionError) throw new Error(executionError);
      const images = entry.outputs?.[saveNodeId]?.images ?? [];
      if (images.length) return images.map(toGeneratedImage);
      if (entry.status?.completed || entry.status?.status_str === "error") {
        throw new Error("Holopix 工作流已结束，但 SaveImage 节点没有输出图片。");
      }
    }
    await delay(1000, signal);
  }
  throw new Error(`等待 Holopix 生成超时（${timeoutSeconds} 秒）。`);
}

function toGeneratedImage(image: HistoryImage): AiGeneratedImage {
  if (!image.filename) throw new Error("ComfyUI 返回了缺少 filename 的图片记录。");
  const subfolder = image.subfolder ?? "";
  const type = image.type ?? "output";
  const query = new URLSearchParams({ filename: image.filename, subfolder, type });
  return {
    filename: image.filename,
    subfolder,
    type,
    url: `${DEFAULT_COMFY_URL}/view?${query.toString()}`
  };
}

async function fetchJson(url: string, init?: RequestInit, timeoutMs = 15_000): Promise<unknown> {
  let response: Response;
  const controller = new AbortController();
  const externalSignal = init?.signal;
  const abortFromExternal = (): void => controller.abort();
  externalSignal?.addEventListener("abort", abortFromExternal, { once: true });
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    response = await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (externalSignal?.aborted) throw abortError();
    if (controller.signal.aborted) throw new Error(`连接本机 ComfyUI 超时（${Math.round(timeoutMs / 1000)} 秒）。`);
    throw new Error(`无法连接本机 ComfyUI（${DEFAULT_COMFY_URL}）：${error instanceof Error ? error.message : String(error)}`);
  } finally {
    window.clearTimeout(timeout);
    externalSignal?.removeEventListener("abort", abortFromExternal);
  }
  const text = await response.text();
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

function findExecutionError(messages: unknown[] | undefined): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (const message of messages) {
    if (!Array.isArray(message) || message[0] !== "execution_error") continue;
    const detail = message[1];
    if (detail && typeof detail === "object") {
      const record = detail as Record<string, unknown>;
      return `Holopix 节点执行失败：${String(record.exception_message ?? record.error ?? JSON.stringify(record))}`;
    }
    return `Holopix 节点执行失败：${String(detail)}`;
  }
  return undefined;
}

function makeRequestNonce(batchIndex: number): number {
  const base = Date.now() % 2_000_000_000;
  return base + batchIndex;
}

function safePathSegment(value: string): string {
  return value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 80) || "unnamed";
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
