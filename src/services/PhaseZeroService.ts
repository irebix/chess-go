import type { ExtractedImage } from "../infrastructure/xlsx/extractKnownImage";
import { extractKnownImage } from "../infrastructure/xlsx/extractKnownImage";
import {
  deleteTemporaryFile,
  selectPsdOutput,
  selectXlsxFile,
  writeTemporaryImage
} from "../infrastructure/filesystem/uxpFiles";
import { generatePhaseZeroPsd, type GenerationProgress } from "../photoshop/phaseZeroGenerator";

export interface ImportedPhaseZeroData extends ExtractedImage {
  sourceName: string;
  sourceSize?: number;
  sourceModifiedAt?: string;
}

export async function importPhaseZeroXlsx(): Promise<ImportedPhaseZeroData> {
  const source = await selectXlsxFile();
  const extracted = await extractKnownImage(source.bytes);
  return {
    ...extracted,
    sourceName: source.name,
    sourceSize: source.size,
    sourceModifiedAt: source.modifiedAt
  };
}

export async function savePhaseZeroPsd(
  imported: ImportedPhaseZeroData,
  onProgress?: (progress: GenerationProgress) => void
): Promise<void> {
  const output = await selectPsdOutput(defaultOutputName(imported.sourceName));
  const temporaryImage = await writeTemporaryImage(imported.bytes);
  try {
    await generatePhaseZeroPsd({ imageFile: temporaryImage, outputFile: output, onProgress });
  } finally {
    await deleteTemporaryFile(temporaryImage);
  }
}

function defaultOutputName(sourceName: string): string {
  const stem = sourceName.replace(/\.xlsx$/i, "") || "棋子归档";
  return `${stem}_Phase0.psd`;
}
