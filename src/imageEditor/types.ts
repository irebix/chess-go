import type { CenterlineLayerSource, CenterlinePixelSource } from "../centerline/types";

export type ImageEditorWorkflowVersion = "v2" | "v3";
export type ImageEditorBatchSize = 1 | 2 | 4;
export type ImageEditorInsertPosition = "above" | "top";

export interface ImageEditorGeneratedImage {
  filename: string;
  subfolder: string;
  type: string;
  url: string;
}

export interface ImageEditorGenerationOptions {
  pixels: CenterlinePixelSource;
  promptText: string;
  workflowVersion: ImageEditorWorkflowVersion;
  batchSize: ImageEditorBatchSize;
  signal?: AbortSignal;
  onPromptId?: (promptId: string) => void;
  onStage?: (stage: string) => void;
}

export interface ImageEditorReadyResult {
  images: ImageEditorGeneratedImage[];
  source: CenterlineLayerSource;
  sourceBounds: ImageEditorSourceBounds;
  workflowVersion: ImageEditorWorkflowVersion;
}

export interface ImageEditorSourceBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
