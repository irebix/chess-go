import type { AiGeneratedImage } from "../domain/aiCandidates";

interface RecoveryImage {
  filename?: string;
  subfolder?: string;
  type?: string;
}

interface RecoveryEntry {
  outputs?: Record<string, { images?: RecoveryImage[] }>;
}

export function collectRecentHolopixImages(
  history: Record<string, RecoveryEntry>,
  assetCodes: string[],
  baseUrl: string
): Record<string, AiGeneratedImage[]> {
  const codeBySafeName = new Map(assetCodes.map((assetCode) => [safePathSegment(assetCode), assetCode]));
  const recovered: Record<string, AiGeneratedImage[]> = {};
  const seen = new Set<string>();

  for (const entry of Object.values(history)) {
    for (const output of Object.values(entry.outputs ?? {})) {
      for (const image of output.images ?? []) {
        if (!image.filename || (image.type ?? "output") !== "output") continue;
        if (normalizeSubfolder(image.subfolder) !== "Holopix/ChessGo") continue;
        const safeName = image.filename.replace(/_\d+_\.[^.]+$/i, "");
        const assetCode = codeBySafeName.get(safeName);
        if (!assetCode) continue;
        const generated = toGeneratedImage(image, baseUrl);
        if (seen.has(generated.url)) continue;
        seen.add(generated.url);
        (recovered[assetCode] ??= []).push(generated);
      }
    }
  }

  for (const images of Object.values(recovered)) {
    images.sort((left, right) => imageSequence(right.filename) - imageSequence(left.filename));
  }
  return recovered;
}

function toGeneratedImage(image: RecoveryImage, baseUrl: string): AiGeneratedImage {
  const filename = image.filename!;
  const subfolder = image.subfolder ?? "";
  const type = image.type ?? "output";
  const query = new URLSearchParams({ filename, subfolder, type });
  return { filename, subfolder, type, url: `${baseUrl}/view?${query.toString()}` };
}

function normalizeSubfolder(value: string | undefined): string {
  return (value ?? "").replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function imageSequence(filename: string): number {
  const match = filename.match(/_(\d+)_\.[^.]+$/i);
  return match ? Number(match[1]) : 0;
}

function safePathSegment(value: string): string {
  return value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 80) || "unnamed";
}
