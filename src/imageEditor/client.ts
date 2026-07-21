import { storage } from "uxp";
import { fetchComfyJson, queueComfyWorkflow } from "../ai/holopixClient";
import { COMFY_BASE_URL } from "../ai/holopixEndpoint";
import {
  findHolopixExecutionError,
  type HolopixHistoryEntry,
  type HolopixHistoryImage
} from "../ai/holopixGenerationResult";
import { pixelsToPpm } from "../centerline/client";
import {
  assertImageEditorWorkflow,
  IMAGE_EDITOR_REQUIRED_NODE_TYPES,
  prepareImageEditorWorkflow
} from "./workflow";
import type {
  ImageEditorGeneratedImage,
  ImageEditorGenerationOptions
} from "./types";
import type { ComfyWorkflow } from "../ai/holopixWorkflow";

interface UploadedImage {
  name?: string;
  subfolder?: string;
}

let workflowPromise: Promise<ComfyWorkflow> | null = null;
let lastRequestNonce = 0;

export class ImageEditorComfyClient {
  async health(signal?: AbortSignal): Promise<void> {
    await fetchComfyJson(`${COMFY_BASE_URL}/system_stats`, { signal }, 10_000);
    const infos = await Promise.all(IMAGE_EDITOR_REQUIRED_NODE_TYPES.map((nodeType) => (
      fetchComfyJson(
        `${COMFY_BASE_URL}/object_info/${encodeURIComponent(nodeType)}`,
        { signal },
        10_000
      ) as Promise<Record<string, unknown>>
    )));
    const missing = IMAGE_EDITOR_REQUIRED_NODE_TYPES.filter((nodeType, index) => !infos[index]?.[nodeType]);
    if (missing.length) throw new Error(`AI编辑工作流缺少 ComfyUI 节点：${missing.join("、")}`);
  }

  async generate(options: ImageEditorGenerationOptions): Promise<ImageEditorGeneratedImage[]> {
    throwIfAborted(options.signal);
    const baseWorkflow = await loadBundledWorkflow();
    const requestNonce = nextRequestNonce();
    options.onStage?.("正在上传当前选中图层");
    const uploaded = await uploadSelectedLayer(options, requestNonce);
    const imageName = safeUploadedImageName(uploaded);
    throwIfAborted(options.signal);

    const versionLabel = options.workflowVersion.toUpperCase();
    const prepared = prepareImageEditorWorkflow(baseWorkflow, {
      workflowVersion: options.workflowVersion,
      imageName,
      promptText: options.promptText,
      batchSize: options.batchSize,
      requestNonce,
      filenamePrefix: `Holopix/ChessGo/ImageEditor/${versionLabel}/${requestNonce}`
    });
    options.onStage?.(`正在提交 Holopix ${versionLabel} 工作流`);
    const queued = await queueComfyWorkflow(
      prepared.workflow,
      options.signal,
      options.onStage
    );
    options.onPromptId?.(queued.promptId);
    try {
      return await waitForImages(
        queued.promptId,
        prepared.saveNodeId,
        options.batchSize,
        prepared.timeoutSeconds + 60,
        options.signal,
        options.onStage
      );
    } finally {
      queued.stopStatusMonitor();
    }
  }

  async cancel(promptId: string): Promise<void> {
    try {
      await fetchComfyJson(`${COMFY_BASE_URL}/queue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ delete: [promptId] })
      }, 8000);
    } catch {
      // The prompt may already be running; interrupt is attempted below.
    }
    await fetchComfyJson(`${COMFY_BASE_URL}/interrupt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt_id: promptId })
    }, 8000);
  }
}

async function loadBundledWorkflow(): Promise<ComfyWorkflow> {
  workflowPromise ??= (async () => {
    const provider = storage.localFileSystem;
    if (!provider.getPluginFolder) throw new Error("当前 UXP 不支持读取插件目录中的 ImageEditor.json。");
    const folder = await provider.getPluginFolder();
    if (!folder.getEntry) throw new Error("当前 UXP 不支持读取 ImageEditor.json。");
    const entry = await folder.getEntry("ImageEditor.json");
    if (!entry.isFile) throw new Error("插件目录中的 ImageEditor.json 不是文件。");
    const raw = await (entry as storage.File).read({ format: storage.formats.utf8 });
    if (typeof raw !== "string") throw new Error("ImageEditor.json 未按 UTF-8 文本读取。");
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      throw new Error(`ImageEditor.json 解析失败：${error instanceof Error ? error.message : String(error)}`);
    }
    assertImageEditorWorkflow(parsed);
    return parsed;
  })();
  return workflowPromise;
}

async function uploadSelectedLayer(
  options: ImageEditorGenerationOptions,
  requestNonce: number
): Promise<UploadedImage> {
  const ppm = pixelsToPpm(options.pixels);
  const copy = ppm.buffer.slice(ppm.byteOffset, ppm.byteOffset + ppm.byteLength) as ArrayBuffer;
  const form = new FormData();
  form.append(
    "image",
    new Blob([copy], { type: "image/x-portable-pixmap" }),
    `selected-layer-${requestNonce}.ppm`
  );
  form.append("type", "input");
  form.append("subfolder", `chessgo_image_editor/run-${requestNonce}`);
  form.append("overwrite", "false");
  return fetchComfyJson(`${COMFY_BASE_URL}/upload/image`, {
    method: "POST",
    body: form,
    signal: options.signal
  }, 60_000) as Promise<UploadedImage>;
}

async function waitForImages(
  promptId: string,
  saveNodeId: string,
  expectedCount: number,
  timeoutSeconds: number,
  signal?: AbortSignal,
  onStage?: (stage: string) => void
): Promise<ImageEditorGeneratedImage[]> {
  const deadline = Date.now() + timeoutSeconds * 1000;
  while (Date.now() < deadline) {
    throwIfAborted(signal);
    let history: Record<string, HolopixHistoryEntry>;
    try {
      history = await fetchComfyJson(
        `${COMFY_BASE_URL}/history/${encodeURIComponent(promptId)}`,
        { signal },
        12_000
      ) as Record<string, HolopixHistoryEntry>;
    } catch (error) {
      if (signal?.aborted) throw abortError();
      await delay(1000, signal);
      continue;
    }
    const entry = history[promptId];
    if (entry) {
      const executionError = findHolopixExecutionError(entry.status?.messages);
      if (executionError) throw new Error(executionError);
      const images = entry.outputs?.[saveNodeId]?.images ?? [];
      if (images.length >= expectedCount) return images.slice(0, expectedCount).map(toGeneratedImage);
      if (entry.status?.completed) {
        if (images.length) {
          onStage?.(`工作流仅返回 ${images.length}/${expectedCount} 张图片，保留已有结果`);
          return images.map(toGeneratedImage);
        }
        throw new Error("AI编辑工作流已完成，但 SaveImage 没有输出图片。");
      }
    }
    await delay(1000, signal);
  }
  throw new Error(`等待 AI编辑结果超时（${timeoutSeconds} 秒）。`);
}

function toGeneratedImage(image: HolopixHistoryImage): ImageEditorGeneratedImage {
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

function safeUploadedImageName(uploaded: UploadedImage): string {
  if (!uploaded.name) throw new Error("ComfyUI 上传图层后没有返回文件名。");
  const filename = uploaded.name.replace(/\\/g, "/").split("/").pop();
  const subfolder = String(uploaded.subfolder ?? "").replace(/\\/g, "/");
  if (!filename || subfolder.includes("..")) throw new Error("ComfyUI 返回了不安全的上传路径。");
  return subfolder ? `${subfolder}/${filename}` : filename;
}

function nextRequestNonce(): number {
  lastRequestNonce = Math.max(lastRequestNonce + 1, Date.now());
  return lastRequestNonce;
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
  const error = new Error("AI编辑任务已停止等待；已提交的 Holopix 任务可能仍在后台运行。");
  error.name = "AbortError";
  return error;
}
