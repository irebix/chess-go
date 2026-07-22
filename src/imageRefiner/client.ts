import { storage } from "uxp";
import { fetchComfyJson, queueComfyWorkflow } from "../ai/holopixClient";
import { COMFY_BASE_URL } from "../ai/holopixEndpoint";
import {
  findHolopixExecutionError,
  type HolopixHistoryEntry,
  type HolopixHistoryImage
} from "../ai/holopixGenerationResult";
import type { ComfyWorkflow } from "../ai/holopixWorkflow";
import { readLayerPixels } from "../centerline/layerSource";
import type { ImageEditorGeneratedImage } from "../imageEditor/types";
import { pixelsToPng } from "./png";
import type { ImageRefinerGenerationOptions } from "./types";
import { IMAGE_REFINER_MAX_LAYERS } from "./types";
import { resolveImageRefinerUploadPath } from "./uploadPath";
import {
  assertImageRefinerWorkflow,
  IMAGE_REFINER_REQUIRED_NODE_TYPES,
  prepareImageRefinerWorkflow
} from "./workflow";

interface UploadedImage {
  name?: string;
  subfolder?: string;
}

interface UploadedInput {
  filename: string;
}

interface ImageRefinerBundledResources {
  workflow: ComfyWorkflow;
  styleReference: Uint8Array;
}

const IMAGE_REFINER_STYLE_ASSET = "ImageRefinerStyle.png";

let bundledResourcesPromise: Promise<ImageRefinerBundledResources> | null = null;
let lastRequestNonce = 0;

export class ImageRefinerComfyClient {
  async health(signal?: AbortSignal): Promise<void> {
    await fetchComfyJson(`${COMFY_BASE_URL}/system_stats`, { signal }, 10_000);
    const infos = await Promise.all(IMAGE_REFINER_REQUIRED_NODE_TYPES.map((nodeType) => (
      fetchComfyJson(
        `${COMFY_BASE_URL}/object_info/${encodeURIComponent(nodeType)}`,
        { signal },
        10_000
      ) as Promise<Record<string, unknown>>
    )));
    const missing = IMAGE_REFINER_REQUIRED_NODE_TYPES.filter((nodeType, index) => !infos[index]?.[nodeType]);
    if (missing.length) throw new Error(`AI细化工作流缺少 ComfyUI 节点：${missing.join("、")}`);
  }

  async generate(options: ImageRefinerGenerationOptions): Promise<ImageEditorGeneratedImage[]> {
    throwIfAborted(options.signal);
    const layerCount = options.source.layers.length;
    if (!layerCount || layerCount > IMAGE_REFINER_MAX_LAYERS) {
      throw new Error(`AI细化每批需要 1–${IMAGE_REFINER_MAX_LAYERS} 个图层。`);
    }
    const resources = await loadBundledResources();
    const requestNonce = nextRequestNonce();
    const requestedSubfolder = `chessgo_image_refiner/run-${requestNonce}`;
    const uploaded: UploadedInput[] = [];

    for (let index = 0; index < layerCount; index += 1) {
      throwIfAborted(options.signal);
      const layer = options.source.layers[index]!;
      options.onStage?.(`正在读取并上传图层 ${index + 1}/${layerCount} · ${layer.layerName}`);
      let pixels;
      try {
        pixels = await readLayerPixels(layer, {
          commandName: "AI细化 · 读取图层组图片",
          includeAlpha: true
        });
      } catch (error) {
        throw new Error(`无法读取细化图层“${layer.layerName}”：${errorMessage(error)}`);
      }
      const filename = `${String(index + 1).padStart(3, "0")}.png`;
      const itemSubfolder = `${requestedSubfolder}/${String(index + 1).padStart(3, "0")}`;
      uploaded.push(await uploadImageBytes(
        pixelsToPng(pixels),
        filename,
        requestedSubfolder,
        itemSubfolder,
        options.signal
      ));
      options.onUploadProgress?.(index + 1, layerCount);
    }

    throwIfAborted(options.signal);
    options.onStage?.("正在上传固定风格参考图 · 图2");
    const styleItemSubfolder = `${requestedSubfolder}/style`;
    const uploadedStyle = await uploadImageBytes(
      resources.styleReference,
      IMAGE_REFINER_STYLE_ASSET,
      requestedSubfolder,
      styleItemSubfolder,
      options.signal
    );

    const prepared = prepareImageRefinerWorkflow(resources.workflow, {
      inputSubfolder: requestedSubfolder,
      fileNames: uploaded.map((item) => item.filename),
      styleImagePath: `${requestedSubfolder}/${uploadedStyle.filename}`,
      promptSupplement: options.promptSupplement,
      requestNonce,
      outputSubfolder: `Holopix/ChessGo/ImageRefiner/${requestNonce}`
    });
    options.onStage?.(`正在提交 Holopix V3 · ${layerCount} 个图层`);
    const queued = await queueComfyWorkflow(prepared.workflow, options.signal, options.onStage);
    options.onPromptId?.(queued.promptId);
    try {
      return await waitForImages(
        queued.promptId,
        prepared.saveNodeId,
        layerCount,
        prepared.timeoutSeconds + 90,
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

async function loadBundledResources(): Promise<ImageRefinerBundledResources> {
  bundledResourcesPromise ??= (async () => {
    const provider = storage.localFileSystem;
    if (!provider.getPluginFolder) throw new Error("当前 UXP 不支持读取 AI细化插件资源。");
    const folder = await provider.getPluginFolder();
    if (!folder.getEntry) throw new Error("当前 UXP 不支持读取 AI细化插件资源。");
    const [workflowEntry, styleEntry] = await Promise.all([
      folder.getEntry("ImageRefiner.json"),
      folder.getEntry(IMAGE_REFINER_STYLE_ASSET)
    ]);
    if (!workflowEntry.isFile) throw new Error("插件目录中的 ImageRefiner.json 不是文件。");
    if (!styleEntry.isFile) throw new Error(`插件目录中的 ${IMAGE_REFINER_STYLE_ASSET} 不是文件。`);
    const [rawWorkflow, rawStyle] = await Promise.all([
      (workflowEntry as storage.File).read({ format: storage.formats.utf8 }),
      (styleEntry as storage.File).read({ format: storage.formats.binary })
    ]);
    if (typeof rawWorkflow !== "string") throw new Error("ImageRefiner.json 未按 UTF-8 文本读取。");
    if (!(rawStyle instanceof ArrayBuffer) || !rawStyle.byteLength) {
      throw new Error(`${IMAGE_REFINER_STYLE_ASSET} 未按二进制图片读取。`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawWorkflow);
    } catch (error) {
      throw new Error(`ImageRefiner.json 解析失败：${errorMessage(error)}`);
    }
    assertImageRefinerWorkflow(parsed);
    return {
      workflow: parsed,
      styleReference: new Uint8Array(rawStyle)
    };
  })();
  return bundledResourcesPromise;
}

async function uploadImageBytes(
  imageBytes: Uint8Array,
  filename: string,
  runSubfolder: string,
  itemSubfolder: string,
  signal?: AbortSignal
): Promise<UploadedInput> {
  const copy = imageBytes.buffer.slice(
    imageBytes.byteOffset,
    imageBytes.byteOffset + imageBytes.byteLength
  ) as ArrayBuffer;
  const form = new FormData();
  form.append("image", new Blob([copy], { type: "image/png" }), filename);
  form.append("subfolder", itemSubfolder);
  form.append("type", "input");
  form.append("overwrite", "true");
  const response = await fetchComfyJson(`${COMFY_BASE_URL}/upload/image`, {
    method: "POST",
    body: form,
    signal
  }, 60_000) as UploadedImage;
  return resolveImageRefinerUploadPath(response, runSubfolder, itemSubfolder);
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
    } catch {
      if (signal?.aborted) throw abortError();
      await delay(1000, signal);
      continue;
    }
    const entry = history[promptId];
    if (entry) {
      const executionError = findHolopixExecutionError(entry.status?.messages);
      if (executionError) throw new Error(executionError);
      const images = entry.outputs?.[saveNodeId]?.images ?? [];
      if (images.length >= expectedCount) {
        return images.slice(0, expectedCount).map(toGeneratedImage);
      }
      if (entry.status?.completed) {
        if (images.length) {
          onStage?.(`工作流仅返回 ${images.length}/${expectedCount} 张图片，保留已有结果`);
          return images.map(toGeneratedImage);
        }
        throw new Error("AI细化工作流已完成，但保存节点没有输出图片。");
      }
    }
    await delay(1000, signal);
  }
  throw new Error(`等待 AI细化结果超时（${timeoutSeconds} 秒）。`);
}

function toGeneratedImage(image: HolopixHistoryImage): ImageEditorGeneratedImage {
  if (!image.filename) throw new Error("ComfyUI 返回了缺少 filename 的 AI细化图片记录。");
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
  const error = new Error("AI细化任务已停止等待；已提交的 Holopix 任务可能仍在后台运行。");
  error.name = "AbortError";
  return error;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
