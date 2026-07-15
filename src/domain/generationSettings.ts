export const GENERATION_SETTINGS_STORAGE_KEY = "chess-go-generation-settings";
export const DEFAULT_EDITABLE_CANVAS_SIZE = 1024;
export const MIN_EDITABLE_CANVAS_SIZE = 1;
export const MAX_EDITABLE_CANVAS_SIZE = 30000;
export const DEFAULT_ARTBOARD_SPACING = 50;
export const MIN_ARTBOARD_SPACING = 0;
export const MAX_ARTBOARD_SPACING = 1000;

export interface GenerationSettings {
  version: 1;
  editableCanvasSize: number;
  artboardSpacing: number;
}

export function defaultGenerationSettings(): GenerationSettings {
  return {
    version: 1,
    editableCanvasSize: DEFAULT_EDITABLE_CANVAS_SIZE,
    artboardSpacing: DEFAULT_ARTBOARD_SPACING
  };
}

export function isValidEditableCanvasSize(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_EDITABLE_CANVAS_SIZE && value <= MAX_EDITABLE_CANVAS_SIZE;
}

export function isValidArtboardSpacing(value: number): boolean {
  return Number.isInteger(value) && value >= MIN_ARTBOARD_SPACING && value <= MAX_ARTBOARD_SPACING;
}

export function parseGenerationSettings(raw: string | null): GenerationSettings | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<GenerationSettings> | null;
    if (
      !value ||
      value.version !== 1 ||
      typeof value.editableCanvasSize !== "number" ||
      typeof value.artboardSpacing !== "number" ||
      !isValidEditableCanvasSize(value.editableCanvasSize) ||
      !isValidArtboardSpacing(value.artboardSpacing)
    ) {
      return null;
    }
    return {
      version: 1,
      editableCanvasSize: value.editableCanvasSize,
      artboardSpacing: value.artboardSpacing
    };
  } catch {
    return null;
  }
}
