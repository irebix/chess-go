import { action, app, core } from "photoshop";
import type { GroupLayoutBackground } from "../domain/groupLayoutMetadata";
import {
  makeArtboardBackgroundBatchDescriptors,
  selectLayerDescriptor
} from "./actionDescriptors";
import {
  readGeneratedArtboardBackground,
  writeGeneratedArtboardBackground
} from "./groupArtboardOverlay";

export const DEFAULT_ARTBOARD_BACKGROUND_COLOR: RgbColor = {
  red: 199,
  green: 212,
  blue: 226
};

export interface RgbColor {
  red: number;
  green: number;
  blue: number;
}

export interface ArtboardBackgroundState {
  available: boolean;
  visible: boolean;
  count: number;
}

interface BatchPlayResult {
  _obj?: string;
  message?: string;
  result?: number;
}

export function inspectArtboardBackgrounds(documentValue: unknown): ArtboardBackgroundState {
  const state = readGeneratedArtboardBackground(documentValue);
  return {
    available: Boolean(state?.artboardIds.length),
    visible: state?.visible ?? false,
    count: state?.artboardIds.length ?? 0
  };
}

export async function initializeArtboardBackgrounds(
  documentValue: unknown,
  artboardIds: number[],
  color: RgbColor = DEFAULT_ARTBOARD_BACKGROUND_COLOR
): Promise<void> {
  await applyArtboardBackgrounds(documentValue, artboardIds, normalizeColor(color), true);
}

export async function applyStoredArtboardBackgrounds(documentValue: unknown): Promise<number> {
  const state = readGeneratedArtboardBackground(documentValue);
  if (!state) return 0;
  await applyArtboardBackgrounds(documentValue, state.artboardIds, state.color, state.visible);
  return state.artboardIds.length;
}

export async function setArtboardBackgroundVisibility(
  documentValue: unknown,
  visible: boolean
): Promise<number> {
  const state = readGeneratedArtboardBackground(documentValue);
  if (!state) return 0;
  const background = normalizedBackground(state.color, visible);
  await applyArtboardBackgrounds(documentValue, state.artboardIds, background.color, background.visible);
  writeGeneratedArtboardBackground(documentValue, background);
  return state.artboardIds.length;
}

export async function setArtboardBackgroundColor(
  documentValue: unknown,
  color: RgbColor
): Promise<number> {
  const state = readGeneratedArtboardBackground(documentValue);
  if (!state) return 0;
  const background = normalizedBackground(color, true);
  await applyArtboardBackgrounds(documentValue, state.artboardIds, background.color, true);
  writeGeneratedArtboardBackground(documentValue, background);
  return state.artboardIds.length;
}

export async function choosePhotoshopForegroundColor(): Promise<RgbColor | null> {
  const initial = foregroundRgb();
  let results: BatchPlayResult[] = [];
  try {
    await core.executeAsModal(
      async () => {
        results = await action.batchPlay(
          [{
            _obj: "set",
            _target: [{ _ref: "color", _property: "foregroundColor" }],
            to: rgbDescriptor(initial),
            _options: {
              dialogOptions: "display",
              suppressProgressBar: true
            }
          }],
          {}
        ) as unknown as BatchPlayResult[];
      },
      { commandName: "选择底板颜色" }
    );
  } catch (error) {
    if (isUserCancelled(error)) return null;
    throw error;
  }

  const cancelled = results.some((result) => result?._obj?.toLowerCase() === "error" && result.result === -128);
  if (cancelled) return null;
  assertBatchPlaySucceeded(results, "打开 Photoshop 拾色器失败");
  return foregroundRgb();
}

async function applyArtboardBackgrounds(
  documentValue: unknown,
  artboardIds: number[],
  color: RgbColor,
  visible: boolean
): Promise<void> {
  const uniqueIds = Array.from(new Set(artboardIds.filter((id) => Number.isInteger(id) && id > 0)));
  if (!uniqueIds.length) return;
  const normalized = normalizeColor(color);
  const selectedLayerIds = activeLayerIds(documentValue);
  const descriptors = makeArtboardBackgroundBatchDescriptors(
    uniqueIds,
    visible ? normalized : null
  );

  try {
    const results = await action.batchPlay(descriptors, {}) as unknown as BatchPlayResult[];
    assertBatchPlaySucceeded(results, visible ? "设置画板底板颜色失败" : "隐藏画板底板失败");
  } finally {
    await restoreLayerSelection(selectedLayerIds);
  }
}

function activeLayerIds(documentValue: unknown): number[] {
  const document = documentValue as { activeLayers?: ArrayLike<{ id?: number }> } | null;
  const activeLayers = document?.activeLayers;
  if (!activeLayers) return [];
  const ids: number[] = [];
  for (let index = 0; index < activeLayers.length; index += 1) {
    const id = activeLayers[index]?.id;
    if (typeof id === "number" && Number.isInteger(id) && id > 0) ids.push(id);
  }
  return Array.from(new Set(ids));
}

async function restoreLayerSelection(layerIds: number[]): Promise<void> {
  if (!layerIds.length) return;
  try {
    await action.batchPlay(
      layerIds.map((id, index) => selectLayerDescriptor(id, index > 0)),
      {}
    );
  } catch {
    // A deleted or replaced layer should not mask the completed background update.
  }
}

function normalizedBackground(color: RgbColor, visible: boolean): GroupLayoutBackground {
  return { color: normalizeColor(color), visible };
}

function foregroundRgb(): RgbColor {
  const rgb = app.foregroundColor.rgb;
  return normalizeColor(rgb);
}

function normalizeColor(color: RgbColor): RgbColor {
  return {
    red: clampChannel(color.red),
    green: clampChannel(color.green),
    blue: clampChannel(color.blue)
  };
}

function rgbDescriptor(color: RgbColor): Record<string, unknown> {
  const normalized = normalizeColor(color);
  return {
    _obj: "RGBColor",
    red: normalized.red,
    grain: normalized.green,
    blue: normalized.blue
  };
}

function clampChannel(value: number): number {
  return Math.round(Math.max(0, Math.min(255, Number(value) || 0)));
}

function assertBatchPlaySucceeded(results: BatchPlayResult[], context: string): void {
  const failure = results.find((result) => result?._obj?.toLowerCase() === "error" && result.result !== 0);
  if (!failure) return;
  throw new Error(`${context}：${failure.message || `Photoshop 错误 ${failure.result ?? "未知"}`}`);
}

function isUserCancelled(error: unknown): boolean {
  const value = error as { number?: number; result?: number; message?: string } | null;
  return value?.number === -128 || value?.result === -128 || /cancel|取消/i.test(value?.message ?? "");
}
