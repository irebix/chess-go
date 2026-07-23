import type { AiGeneratedImage } from "../domain/aiCandidates";
import { safeGptImage2OutputName } from "./gptImage2Workflow";

const GPT_IMAGE_2_OUTPUT_ROOT = "Holopix/ChessGo/GptImage2";
const GPT_IMAGE_2_GENERATE_TITLE = "GPT Image 2｜整链生成";

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

export interface NamedChainRecoveryOptions {
  outputRoot: string;
  generateClassType: string;
  generateTitle: string;
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
  return collectRecentNamedChainImages(history, assetCodes, baseUrl, {
    outputRoot: GPT_IMAGE_2_OUTPUT_ROOT,
    generateClassType: "HolopixGenerateV3",
    generateTitle: GPT_IMAGE_2_GENERATE_TITLE
  });
}

export function collectRecentNamedChainImages(
  history: Record<string, RecoveryEntry>,
  assetCodes: string[],
  baseUrl: string,
  options: NamedChainRecoveryOptions
): Record<string, AiGeneratedImage[]> {
  const outputRoot = normalizeSubfolder(options.outputRoot);
  if (!outputRoot) throw new Error("整链恢复输出目录不能为空。");
  const recovered = new Map(assetCodes.map((assetCode) => [assetCode, [] as RecoveredImage[]]));
  for (const entry of Object.values(history)) {
    if (!isNamedChainEntry(entry, options)) continue;
    const entrySequence = historySequence(entry);
    for (const output of Object.values(entry.outputs ?? {})) {
      for (const image of output.images ?? []) {
        if (!image.filename || (image.type ?? "output") !== "output") continue;
        const subfolder = normalizeSubfolder(image.subfolder);
        if (!subfolder.startsWith(`${outputRoot}/`)) continue;
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
  return collectNamedChainImagesForPromptId(history, promptId, assetCode, baseUrl, {
    outputRoot: GPT_IMAGE_2_OUTPUT_ROOT,
    generateClassType: "HolopixGenerateV3",
    generateTitle: GPT_IMAGE_2_GENERATE_TITLE
  });
}

export function collectNamedChainImagesForPromptId(
  history: Record<string, RecoveryEntry>,
  promptId: string,
  assetCode: string,
  baseUrl: string,
  options: NamedChainRecoveryOptions
): AiGeneratedImage[] {
  const entry = history[promptId];
  if (!entry) return [];
  return collectRecentNamedChainImages(
    { [promptId]: entry },
    [assetCode],
    baseUrl,
    options
  )[assetCode] ?? [];
}

function isNamedChainEntry(
  entry: RecoveryEntry,
  options: Pick<NamedChainRecoveryOptions, "generateClassType" | "generateTitle">
): boolean {
  const workflow = extractWorkflow(entry.prompt);
  return Boolean(workflow && Object.values(workflow).some((node) => (
    node?.class_type === options.generateClassType
    && node._meta?.title === options.generateTitle
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
