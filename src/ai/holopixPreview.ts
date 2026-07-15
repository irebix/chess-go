import type { AiGeneratedImage } from "../domain/aiCandidates";

export const HOLOPIX_PREVIEW_MAX_BYTES = 512 * 1024;

export function buildHolopixPreviewUrl(
  image: Pick<AiGeneratedImage, "filename" | "subfolder" | "type">,
  baseUrl: string
): string {
  const query = new URLSearchParams({
    filename: image.filename,
    subfolder: image.subfolder,
    type: image.type,
    preview: "jpeg;70",
    channel: "rgb"
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
  if (!/^image\/(?:jpeg|png|webp)$/.test(normalizedMediaType)) {
    throw new Error(`Holopix 缩略图格式无效：${normalizedMediaType || "unknown"}。`);
  }

  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return `data:${normalizedMediaType};base64,${btoa(binary)}`;
}
