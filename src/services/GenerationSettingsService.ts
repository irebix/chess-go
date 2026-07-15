import {
  GENERATION_SETTINGS_STORAGE_KEY,
  defaultGenerationSettings,
  isValidArtboardSpacing,
  isValidEditableCanvasSize,
  parseGenerationSettings,
  type GenerationSettings
} from "../domain/generationSettings";

export interface SettingsStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function loadGenerationSettings(store: SettingsStorageLike = localStorage): GenerationSettings {
  try {
    return parseGenerationSettings(store.getItem(GENERATION_SETTINGS_STORAGE_KEY)) ?? defaultGenerationSettings();
  } catch {
    return defaultGenerationSettings();
  }
}

export function saveGenerationSettings(
  settings: GenerationSettings,
  store: SettingsStorageLike = localStorage
): boolean {
  if (
    !isValidEditableCanvasSize(settings.editableCanvasSize) ||
    !isValidArtboardSpacing(settings.artboardSpacing)
  ) {
    return false;
  }
  try {
    store.setItem(GENERATION_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch {
    return false;
  }
}
