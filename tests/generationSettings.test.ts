import { describe, expect, it } from "vitest";
import {
  GENERATION_SETTINGS_STORAGE_KEY,
  defaultGenerationSettings,
  parseGenerationSettings
} from "../src/domain/generationSettings";
import {
  loadGenerationSettings,
  saveGenerationSettings,
  type SettingsStorageLike
} from "../src/services/GenerationSettingsService";

class MemoryStorage implements SettingsStorageLike {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("generation settings", () => {
  it("uses 1024 and 50 when no saved settings exist", () => {
    expect(loadGenerationSettings(new MemoryStorage())).toEqual({
      version: 1,
      editableCanvasSize: 1024,
      artboardSpacing: 50
    });
  });

  it("remembers the last valid size and spacing", () => {
    const store = new MemoryStorage();
    expect(saveGenerationSettings({
      version: 1,
      editableCanvasSize: 2048,
      artboardSpacing: 80
    }, store)).toBe(true);
    expect(loadGenerationSettings(store)).toEqual({
      version: 1,
      editableCanvasSize: 2048,
      artboardSpacing: 80
    });
    expect(store.getItem(GENERATION_SETTINGS_STORAGE_KEY)).not.toBeNull();
  });

  it("rejects malformed or out-of-range records", () => {
    expect(parseGenerationSettings("not-json")).toBeNull();
    expect(parseGenerationSettings(JSON.stringify({
      version: 1,
      editableCanvasSize: 0,
      artboardSpacing: 50
    }))).toBeNull();
    expect(defaultGenerationSettings().artboardSpacing).toBe(50);
  });
});
