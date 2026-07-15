import type { AiGeneratedImage } from "../domain/aiCandidates";

export const HOLOPIX_PREVIEW_MAX_BYTES = 128 * 1024;
export const HOLOPIX_PREVIEW_SIZE = 96;

export function buildHolopixPreviewUrl(
  image: Pick<AiGeneratedImage, "filename" | "subfolder" | "type">,
  baseUrl: string
): string {
  const query = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder,
    type: image.type
  });
  return `${baseUrl}/view?${query.toString()}`;
}

export function encodeHolopixPreviewDataUrl(
  bytes: Uint8Array,
  mediaType: string | null
): string {
  if (bytes.byteLength > HOLOPIX_PREVIEW_MAX_BYTES) {
    throw new Error(`Holopix 缩略图超过安全上限（${Math.ceil(bytes.byteLength / 1024)} KiB）。`);
  }
  const normalizedMediaType = (mediaType ?? "").split(";", 1)[0]!.trim().toLowerCase();
  if (normalizedMediaType !== "image/png") {
    throw new Error(`Holopix 缩略图格式无效：${normalizedMediaType || "unknown"}。`);
  }
  const dimensions = readPngDimensions(bytes);
  if (dimensions.width !== HOLOPIX_PREVIEW_SIZE || dimensions.height !== HOLOPIX_PREVIEW_SIZE) {
    throw new Error(
      `Holopix 缩略图尺寸必须为 ${HOLOPIX_PREVIEW_SIZE}×${HOLOPIX_PREVIEW_SIZE}，当前为 ${dimensions.width}×${dimensions.height}。`
    );
  }

  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:${normalizedMediaType};base64,${btoa(binary)}`;
}

export function readPngDimensions(bytes: Uint8Array): { width: number; height: number } {
  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
  const ihdr = [73, 72, 68, 82];
  if (bytes.length < 24
    || pngSignature.some((value, index) => bytes[index] !== value)
    || ihdr.some((value, index) => bytes[index + 12] !== value)) {
    throw new Error("Holopix 缩略图不是有效的 PNG 文件。");
  }
  return {
    width: readUint32BigEndian(bytes, 16),
    height: readUint32BigEndian(bytes, 20)
  };
}

function readUint32BigEndian(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! * 0x1000000)
    + (bytes[offset + 1]! * 0x10000)
    + (bytes[offset + 2]! * 0x100)
    + bytes[offset + 3]!;
}
