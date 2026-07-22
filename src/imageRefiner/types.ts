import type { CenterlineLayerSource } from "../centerline/types";
import type { ImageEditorGeneratedImage, ImageEditorSourceBounds } from "../imageEditor/types";

export const IMAGE_REFINER_MAX_LAYERS = 64;

export const IMAGE_REFINER_BASE_PROMPT =
  "使用图2这种2.5d无描边休闲游戏卡通风格，提高图1的完成度";

export type ImageRefinerLayerKind = "pixel" | "smartObject";

export interface ImageRefinerLayerSource extends CenterlineLayerSource {
  kind: ImageRefinerLayerKind;
  bounds: ImageEditorSourceBounds;
}

export interface ImageRefinerGroupSource {
  documentId: number;
  documentName: string;
  groupId: number;
  groupName: string;
  layers: ImageRefinerLayerSource[];
  skippedLayerCount: number;
}

export interface ImageRefinerGenerationOptions {
  source: ImageRefinerGroupSource;
  promptSupplement: string;
  signal?: AbortSignal;
  onPromptId?: (promptId: string) => void;
  onStage?: (stage: string) => void;
  onUploadProgress?: (completed: number, total: number) => void;
}

export interface ImageRefinerReadyResult {
  images: ImageEditorGeneratedImage[];
  source: ImageRefinerGroupSource;
}

export function imageRefinerOutputGroupName(sourceGroupName: string): string {
  return `${sourceGroupName} 细化`;
}
