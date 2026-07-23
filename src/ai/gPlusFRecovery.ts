import type { AiGeneratedImage } from "../domain/aiCandidates";
import {
  collectNamedChainImagesForPromptId,
  collectRecentNamedChainImages
} from "./gptImage2Recovery";

export const G_PLUS_F_OUTPUT_ROOT = "Holopix/ChessGo/GPlusF";
export const G_PLUS_F_GENERATE_TITLE = "G+F｜Holopix 单图细化";

type ChainHistory = Parameters<typeof collectRecentNamedChainImages>[0];

const recoveryOptions = {
  outputRoot: G_PLUS_F_OUTPUT_ROOT,
  generateClassType: "HolopixGenerate",
  generateTitle: G_PLUS_F_GENERATE_TITLE
} as const;

export function collectRecentGPlusFImages(
  history: ChainHistory,
  assetCodes: string[],
  baseUrl: string
): Record<string, AiGeneratedImage[]> {
  return collectRecentNamedChainImages(history, assetCodes, baseUrl, recoveryOptions);
}

export function collectGPlusFImagesForPromptId(
  history: ChainHistory,
  promptId: string,
  assetCode: string,
  baseUrl: string
): AiGeneratedImage[] {
  return collectNamedChainImagesForPromptId(
    history,
    promptId,
    assetCode,
    baseUrl,
    recoveryOptions
  );
}
