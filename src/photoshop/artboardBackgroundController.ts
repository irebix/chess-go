import { action, app, constants, core } from "photoshop";

export const ARTBOARD_BACKGROUND_LAYER_NAME = "底板颜色";
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

interface LayerLike {
  id: number;
  name: string;
  visible: boolean;
  layers?: LayerCollectionLike;
  move(relativeObject: LayerLike, placement: string): void | Promise<void>;
}

interface LayerCollectionLike {
  length: number;
  [index: number]: LayerLike;
}

interface DocumentLike {
  layers: LayerCollectionLike;
  artboards?: LayerCollectionLike;
  activeLayers: LayerCollectionLike;
}

interface BatchPlayResult {
  _obj?: string;
  message?: string;
  result?: number;
}

export async function createArtboardBackground(
  documentValue: unknown,
  artboardValue: unknown,
  color: RgbColor = DEFAULT_ARTBOARD_BACKGROUND_COLOR
): Promise<void> {
  const document = documentValue as DocumentLike;
  const artboard = artboardValue as LayerLike;
  const results = await action.batchPlay(
    [{
      _obj: "make",
      _target: [{ _ref: "contentLayer" }],
      using: {
        _obj: "contentLayer",
        name: ARTBOARD_BACKGROUND_LAYER_NAME,
        type: {
          _obj: "solidColorLayer",
          color: rgbDescriptor(color)
        }
      },
      _options: { dialogOptions: "dontDisplay" }
    }],
    {}
  ) as unknown as BatchPlayResult[];
  assertBatchPlaySucceeded(results, "创建底板颜色失败");

  const background = collectionValues(document.activeLayers)[0];
  if (!background) throw new Error("Photoshop 未返回新建的底板颜色图层。");
  background.name = ARTBOARD_BACKGROUND_LAYER_NAME;
  await Promise.resolve(background.move(artboard, constants.ElementPlacement.PLACEINSIDE));

  const artboardLayers = collectionValues(artboard.layers);
  const bottomLayer = artboardLayers[artboardLayers.length - 1];
  if (bottomLayer && bottomLayer.id !== background.id) {
    await Promise.resolve(background.move(bottomLayer, constants.ElementPlacement.PLACEAFTER));
  }
}

export function inspectArtboardBackgrounds(documentValue: unknown): ArtboardBackgroundState {
  const layers = findArtboardBackgrounds(documentValue as DocumentLike);
  return {
    available: layers.length > 0,
    visible: layers.some((layer) => layer.visible),
    count: layers.length
  };
}

export function setArtboardBackgroundVisibility(documentValue: unknown, visible: boolean): number {
  const layers = findArtboardBackgrounds(documentValue as DocumentLike);
  for (const layer of layers) layer.visible = visible;
  return layers.length;
}

export async function setArtboardBackgroundColor(
  documentValue: unknown,
  color: RgbColor
): Promise<number> {
  const layers = findArtboardBackgrounds(documentValue as DocumentLike);
  if (!layers.length) return 0;
  const results = await action.batchPlay(
    layers.map((layer) => ({
      _obj: "set",
      _target: [{ _ref: "contentLayer", _id: layer.id }],
      to: {
        _obj: "solidColorLayer",
        color: rgbDescriptor(color)
      },
      _options: { dialogOptions: "dontDisplay" }
    })),
    {}
  ) as unknown as BatchPlayResult[];
  assertBatchPlaySucceeded(results, "修改底板颜色失败");
  return layers.length;
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

function findArtboardBackgrounds(document: DocumentLike): LayerLike[] {
  const backgrounds: LayerLike[] = [];
  const artboards = collectionValues(document.artboards ?? document.layers);
  for (const artboard of artboards) {
    for (const child of collectionValues(artboard.layers)) {
      if (child.name === ARTBOARD_BACKGROUND_LAYER_NAME) backgrounds.push(child);
    }
  }
  return backgrounds;
}

function foregroundRgb(): RgbColor {
  const rgb = app.foregroundColor.rgb;
  return {
    red: clampChannel(rgb.red),
    green: clampChannel(rgb.green),
    blue: clampChannel(rgb.blue)
  };
}

function rgbDescriptor(color: RgbColor): Record<string, unknown> {
  return {
    _obj: "RGBColor",
    red: clampChannel(color.red),
    grain: clampChannel(color.green),
    blue: clampChannel(color.blue)
  };
}

function clampChannel(value: number): number {
  return Math.max(0, Math.min(255, Number(value) || 0));
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

function collectionValues(collection: LayerCollectionLike | undefined): LayerLike[] {
  if (!collection) return [];
  const values: LayerLike[] = [];
  for (let index = 0; index < collection.length; index += 1) {
    const layer = collection[index];
    if (layer) values.push(layer);
  }
  return values;
}
