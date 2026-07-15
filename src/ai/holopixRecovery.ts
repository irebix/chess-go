import type { AiGeneratedImage } from "../domain/aiCandidates";

interface RecoveryImage {
  filename?: string;
  subfolder?: string;
  type?: string;
}

interface RecoveryOutput {
  images?: RecoveryImage[];
  text?: unknown;
}

interface RecoveryEntry {
  outputs?: Record<string, RecoveryOutput>;
  prompt?: unknown;
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
    const promptText = extractRecoveredPromptText(entry);
    for (const output of Object.values(entry.outputs ?? {})) {
      for (const image of output.images ?? []) {
        if (!image.filename || (image.type ?? "output") !== "output") continue;
        if (normalizeSubfolder(image.subfolder) !== "Holopix/ChessGo") continue;
        const safeName = image.filename.replace(/_\d+_\.[^.]+$/i, "");
        const assetCode = codeBySafeName.get(safeName);
        if (!assetCode) continue;
        const generated = toGeneratedImage(image, baseUrl, promptText);
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

function extractRecoveredPromptText(entry: RecoveryEntry): string | undefined {
  for (const output of Object.values(entry.outputs ?? {})) {
    const text = normalizeOutputText(output.text);
    if (text) return text;
  }

  const workflow = extractWorkflow(entry.prompt);
  if (!workflow) return undefined;
  for (const node of Object.values(workflow)) {
    if (node?.class_type !== "HolopixGenerate") continue;
    const prompt = node.inputs?.prompt;
    if (typeof prompt === "string" && prompt.trim()) return prompt.trim();
  }
  return undefined;
}

function normalizeOutputText(value: unknown): string | undefined {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === "string" && candidate.trim() ? candidate.trim() : undefined;
}

function extractWorkflow(value: unknown): Record<string, { class_type?: string; inputs?: Record<string, unknown> }> | undefined {
  if (!Array.isArray(value) || value.length < 3) return undefined;
  const workflow = value[2];
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) return undefined;
  return workflow as Record<string, { class_type?: string; inputs?: Record<string, unknown> }>;
}

function toGeneratedImage(
  image: RecoveryImage,
  baseUrl: string,
  promptText?: string
): AiGeneratedImage {
  const filename = image.filename!;
  const subfolder = image.subfolder ?? "";
  const type = image.type ?? "output";
  const query = new URLSearchParams({ filename, subfolder, type });
  return {
    filename,
    subfolder,
    type,
    url: `${baseUrl}/view?${query.toString()}`,
    promptText
  };
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
