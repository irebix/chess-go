import JSZip from "jszip";
import { normalizeZipEntryName } from "./paths";

export const PHASE_ZERO_IMAGE_ENTRY = "xl/drawings/media/image1.png";

export interface ExtractedImage {
  entryName: string;
  bytes: Uint8Array;
  archiveEntries: string[];
}

export async function extractKnownImage(
  input: ArrayBuffer | Uint8Array,
  requestedEntry = PHASE_ZERO_IMAGE_ENTRY
): Promise<ExtractedImage> {
  const zip = await JSZip.loadAsync(input);
  const archiveEntries = Object.keys(zip.files)
    .filter((name) => !zip.files[name]?.dir)
    .map(normalizeZipEntryName)
    .sort();

  const targetName = normalizeZipEntryName(requestedEntry);
  const entry = zip.file(targetName);
  if (!entry) {
    throw new Error(
      `XLSX 中未找到 Phase 0 图片入口：${targetName}。当前归档共 ${archiveEntries.length} 个文件入口。`
    );
  }

  const bytes = await entry.async("uint8array");
  if (!hasPngSignature(bytes)) {
    throw new Error(`入口 ${targetName} 不是有效的 PNG 数据。`);
  }

  return { entryName: targetName, bytes, archiveEntries };
}

export function hasPngSignature(bytes: Uint8Array): boolean {
  const expected = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return expected.every((value, index) => bytes[index] === value);
}
