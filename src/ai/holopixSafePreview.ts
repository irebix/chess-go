import { decode } from "jpeg-js";
import type { AiCandidatePreview, AiGeneratedImage } from "../domain/aiCandidates";
import type { ComfyWorkflow } from "./holopixWorkflow";

export const HOLOPIX_SAFE_PREVIEW_SIZE = 96;
export const HOLOPIX_SAFE_PREVIEW_MAX_BYTES = 128 * 1024;
export const HOLOPIX_CANVAS_PREVIEW_SIZE = 64;
export const HOLOPIX_CANVAS_SAMPLE_SIZE = 32;
export const HOLOPIX_CANVAS_CELL_GAP = 7;

export interface HolopixCanvasRun {
  x: number;
  y: number;
  width: number;
  color: string;
}

export interface HolopixCanvasStripRun extends HolopixCanvasRun {
  height: number;
}

export interface PreparedHolopixSafePreviewWorkflow {
  workflow: ComfyWorkflow;
  previewNodeId: string;
}

export function prepareHolopixSafePreviewWorkflow(
  image: Pick<AiGeneratedImage, "filename" | "subfolder" | "type">
): PreparedHolopixSafePreviewWorkflow {
  const annotatedPath = buildAnnotatedOutputPath(image);
  const previewNodeId = "3";
  return {
    previewNodeId,
    workflow: {
      "1": {
        class_type: "LoadImage",
        inputs: { image: annotatedPath },
        _meta: { title: "ChessGo load generated output" }
      },
      "2": {
        class_type: "ImageScale",
        inputs: {
          image: ["1", 0],
          upscale_method: "lanczos",
          width: HOLOPIX_SAFE_PREVIEW_SIZE,
          height: HOLOPIX_SAFE_PREVIEW_SIZE,
          crop: "center"
        },
        _meta: { title: "ChessGo safe preview scale" }
      },
      [previewNodeId]: {
        class_type: "PreviewImage",
        inputs: { images: ["2", 0] },
        _meta: { title: "ChessGo safe preview output" }
      }
    }
  };
}

export function buildHolopixSafeJpegUrl(
  image: Pick<AiGeneratedImage, "filename" | "subfolder" | "type">,
  baseUrl: string
): string {
  const query = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder,
    type: image.type,
    preview: "jpeg;82",
    channel: "rgb"
  });
  return `${baseUrl}/view?${query.toString()}`;
}

export function decodeHolopixSafeJpeg(
  bytes: Uint8Array,
  mediaType: string | null
): AiCandidatePreview {
  if (bytes.byteLength > HOLOPIX_SAFE_PREVIEW_MAX_BYTES) {
    throw new Error(`Holopix 安全缩略图超过上限（${Math.ceil(bytes.byteLength / 1024)} KiB）。`);
  }
  const normalizedMediaType = (mediaType ?? "").split(";", 1)[0]!.trim().toLowerCase();
  if (normalizedMediaType !== "image/jpeg") {
    throw new Error(`Holopix 安全缩略图格式无效：${normalizedMediaType || "unknown"}。`);
  }
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error("Holopix 安全缩略图不是有效的 JPEG 文件。");
  }

  const decoded = decode(bytes, {
    useTArray: true,
    formatAsRGBA: true,
    tolerantDecoding: false,
    maxResolutionInMP: 1,
    maxMemoryUsageInMB: 8
  });
  if (decoded.width !== HOLOPIX_SAFE_PREVIEW_SIZE || decoded.height !== HOLOPIX_SAFE_PREVIEW_SIZE) {
    throw new Error(
      `Holopix 安全缩略图尺寸必须为 ${HOLOPIX_SAFE_PREVIEW_SIZE}×${HOLOPIX_SAFE_PREVIEW_SIZE}，`
      + `当前为 ${decoded.width}×${decoded.height}。`
    );
  }
  const expectedLength = decoded.width * decoded.height * 4;
  if (decoded.data.byteLength !== expectedLength) {
    throw new Error("Holopix 安全缩略图像素长度无效。");
  }

  return {
    width: decoded.width,
    height: decoded.height,
    pixels: new Uint8ClampedArray(decoded.data)
  };
}

export function buildHolopixCanvasRuns(
  preview: AiCandidatePreview,
  outputSize = HOLOPIX_CANVAS_PREVIEW_SIZE
): HolopixCanvasRun[] {
  if (!Number.isInteger(outputSize) || outputSize < 1 || outputSize > preview.width || outputSize > preview.height) {
    throw new Error("Holopix Canvas 预览尺寸无效。");
  }
  if (preview.pixels.length !== preview.width * preview.height * 4) {
    throw new Error("Holopix Canvas 预览像素长度无效。");
  }

  const runs: HolopixCanvasRun[] = [];
  for (let y = 0; y < outputSize; y += 1) {
    let runColor = "";
    let runStart = 0;
    for (let x = 0; x < outputSize; x += 1) {
      const color = sampleQuantizedColor(preview, x, y, outputSize);
      if (x === 0) {
        runColor = color;
        continue;
      }
      if (color !== runColor) {
        runs.push({ x: runStart, y, width: x - runStart, color: runColor });
        runStart = x;
        runColor = color;
      }
    }
    runs.push({ x: runStart, y, width: outputSize - runStart, color: runColor });
  }
  return runs;
}

export function holopixCanvasStripWidth(candidateCount: number): number {
  if (!Number.isInteger(candidateCount) || candidateCount < 1 || candidateCount > 4) {
    throw new Error("Holopix Canvas 候选数量无效。");
  }
  return candidateCount * HOLOPIX_CANVAS_PREVIEW_SIZE
    + (candidateCount - 1) * HOLOPIX_CANVAS_CELL_GAP;
}

export function buildHolopixCanvasStripRuns(
  previews: Array<AiCandidatePreview | undefined>
): HolopixCanvasStripRun[] {
  holopixCanvasStripWidth(previews.length);
  const scale = HOLOPIX_CANVAS_PREVIEW_SIZE / HOLOPIX_CANVAS_SAMPLE_SIZE;
  const runs: HolopixCanvasStripRun[] = [];
  previews.forEach((preview, index) => {
    if (!preview) return;
    const offsetX = index * (HOLOPIX_CANVAS_PREVIEW_SIZE + HOLOPIX_CANVAS_CELL_GAP);
    for (const run of buildHolopixCanvasRuns(preview, HOLOPIX_CANVAS_SAMPLE_SIZE)) {
      runs.push({
        x: offsetX + run.x * scale,
        y: run.y * scale,
        width: run.width * scale,
        height: scale,
        color: run.color
      });
    }
  });
  return runs;
}

function sampleQuantizedColor(
  preview: AiCandidatePreview,
  outputX: number,
  outputY: number,
  outputSize: number
): string {
  const startX = Math.floor(outputX * preview.width / outputSize);
  const endX = Math.max(startX + 1, Math.floor((outputX + 1) * preview.width / outputSize));
  const startY = Math.floor(outputY * preview.height / outputSize);
  const endY = Math.max(startY + 1, Math.floor((outputY + 1) * preview.height / outputSize));
  let red = 0;
  let green = 0;
  let blue = 0;
  let count = 0;
  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const offset = (y * preview.width + x) * 4;
      red += preview.pixels[offset]!;
      green += preview.pixels[offset + 1]!;
      blue += preview.pixels[offset + 2]!;
      count += 1;
    }
  }
  return `rgb(${quantizeColor(red / count)},${quantizeColor(green / count)},${quantizeColor(blue / count)})`;
}

function quantizeColor(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value / 16) * 16));
}

function buildAnnotatedOutputPath(
  image: Pick<AiGeneratedImage, "filename" | "subfolder" | "type">
): string {
  if (image.type !== "output") {
    throw new Error(`Holopix 原图类型必须为 output，当前为 ${image.type || "unknown"}。`);
  }
  const filename = normalizePathPart(image.filename, "文件名");
  if (filename.includes("/")) throw new Error("Holopix 原图文件名不能包含目录分隔符。");
  const subfolder = normalizePathPart(image.subfolder, "子目录", true);
  const relativePath = subfolder ? `${subfolder}/${filename}` : filename;
  return `${relativePath} [output]`;
}

function normalizePathPart(value: string, label: string, allowEmpty = false): string {
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized) {
    if (allowEmpty) return "";
    throw new Error(`Holopix 原图${label}为空。`);
  }
  if (normalized.includes("[") || normalized.includes("]")) {
    throw new Error(`Holopix 原图${label}包含无效标记。`);
  }
  if (normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`Holopix 原图${label}包含无效路径。`);
  }
  return normalized;
}
