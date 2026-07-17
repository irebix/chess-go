import type { AiGeneratedImage } from "../domain/aiCandidates";
import { safeGptImage2OutputName } from "./gptImage2Workflow";

const GPT_IMAGE_2_OUTPUT_ROOT = "Holopix/ChessGo/GptImage2";

interface RecoveryImage {
  filename?: string;
  subfolder?: string;
  type?: string;
}

interface RecoveryOutput {
  images?: RecoveryImage[];
}

interface RecoveryEntry {
  outputs?: Record<string, RecoveryOutput>;
  prompt?: unknown;
}

interface RecoveredImage {
  image: AiGeneratedImage;
  sequence: number;
}

export function collectRecentGptImage2Images(
  history: Record<string, RecoveryEntry>,
  assetCodes: string[],
  baseUrl: string
): Record<string, AiGeneratedImage[]> {
  const recovered = new Map(assetCodes.map((assetCode) => [assetCode, [] as RecoveredImage[]]));
  for (const entry of Object.values(history)) {
    if (!isGptImage2Entry(entry)) continue;
    const entrySequence = historySequence(entry);
    for (const output of Object.values(entry.outputs ?? {})) {
      for (const image of output.images ?? []) {
        if (!image.filename || (image.type ?? "output") !== "output") continue;
        const subfolder = normalizeSubfolder(image.subfolder);
        if (!subfolder.startsWith(`${GPT_IMAGE_2_OUTPUT_ROOT}/`)) continue;
        for (const assetCode of assetCodes) {
          if (!matchesAssetCode(image.filename, assetCode)) continue;
          recovered.get(assetCode)!.push({
            image: toGeneratedImage(image, baseUrl),
            sequence: Math.max(entrySequence, subfolderSequence(subfolder))
          });
          break;
        }
      }
    }
  }
  return Object.fromEntries(assetCodes.map((assetCode) => {
    const seen = new Set<string>();
    const images = recovered.get(assetCode)!
      .sort((left, right) => right.sequence - left.sequence)
      .map((entry) => entry.image)
      .filter((image) => {
        if (seen.has(image.url)) return false;
        seen.add(image.url);
        return true;
      });
    return [assetCode, images];
  }));
}

export function collectGptImage2ImagesForPromptId(
  history: Record<string, RecoveryEntry>,
  promptId: string,
  assetCode: string,
  baseUrl: string
): AiGeneratedImage[] {
  const entry = history[promptId];
  if (!entry) return [];
  return collectRecentGptImage2Images({ [promptId]: entry }, [assetCode], baseUrl)[assetCode] ?? [];
}

function isGptImage2Entry(entry: RecoveryEntry): boolean {
  const workflow = extractWorkflow(entry.prompt);
  return Boolean(workflow && Object.values(workflow).some((node) => (
    node?.class_type === "HolopixGenerateV3"
    && node._meta?.title === "GPT Image 2｜整链生成"
  )));
}

function extractWorkflow(value: unknown): Record<string, {
  class_type?: string;
  _meta?: { title?: string };
}> | undefined {
  if (!Array.isArray(value) || value.length < 3) return undefined;
  const workflow = value[2];
  if (!workflow || typeof workflow !== "object" || Array.isArray(workflow)) return undefined;
  return workflow as Record<string, { class_type?: string; _meta?: { title?: string } }>;
}

function matchesAssetCode(filename: string, assetCode: string): boolean {
  const safeName = safeGptImage2OutputName(assetCode).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${safeName}(?:__run\\d+)?\\.png$`, "i").test(filename);
}

function historySequence(entry: RecoveryEntry): number {
  if (!Array.isArray(entry.prompt)) return 0;
  const value = Number(entry.prompt[0]);
  return Number.isFinite(value) ? value : 0;
}

function subfolderSequence(subfolder: string): number {
  const segments = subfolder.split("/");
  const value = Number(segments[segments.length - 1]);
  return Number.isFinite(value) ? value : 0;
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
