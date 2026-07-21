import { action, app, core, imaging, imaging_beta } from "photoshop";
import type {
  CenterlineLayerIdentity,
  CenterlineLayerSource,
  CenterlinePixelSource
} from "./types";

const ACTIVE_LAYER_EVENTS = ["open", "close", "select", "make", "delete"];

function runOptionalPromise(operation: () => void | Promise<void>): Promise<void> {
  try {
    return Promise.resolve(operation());
  } catch {
    return Promise.resolve();
  }
}

interface PixelImageData {
  width: number;
  height: number;
  components: number;
  getData(options: { chunky: true }): Promise<Uint8Array | number[]>;
  dispose(): void;
}

interface PixelResult {
  imageData: PixelImageData;
  sourceBounds?: { left?: number; top?: number };
  level?: number;
}

interface LayerLike {
  id: number;
  layers?: LayerCollectionLike;
}

interface LayerCollectionLike {
  length: number;
  [index: number]: LayerLike;
}

function activeSource(): CenterlineLayerSource {
  if (!app.documents?.length) throw new Error("请先打开 Photoshop 文档。");
  const document = app.activeDocument;
  const layer = document.activeLayers?.[0];
  if (!layer) throw new Error("请先选中一个需要勾线的图层。");
  return {
    documentId: document.id,
    documentName: document.title,
    layerId: layer.id,
    layerName: layer.name
  };
}

export function inspectActiveLayerIdentity(): CenterlineLayerIdentity | null {
  try {
    if (!app.documents?.length) return null;
    const document = app.activeDocument;
    const layer = document.activeLayers?.[0];
    return layer ? { documentId: document.id, layerId: layer.id } : null;
  } catch {
    return null;
  }
}

export function isLayerAvailable(source: CenterlineLayerIdentity): boolean {
  try {
    if (!app.documents?.length) return false;
    const sourceDocument = app.documents.find((document) => document.id === source.documentId);
    if (!sourceDocument) return false;
    const document = sourceDocument as unknown as {
      layers?: LayerCollectionLike;
      artboards?: LayerCollectionLike;
    };
    return collectionContainsLayerId(document.layers, source.layerId)
      || collectionContainsLayerId(document.artboards, source.layerId);
  } catch {
    return false;
  }
}

export function watchActiveLayerIdentity(
  onChange: (identity: CenterlineLayerIdentity | null) => void
): () => void {
  let disposed = false;
  let timer: number | undefined;

  const refresh = (): void => {
    if (disposed) return;
    onChange(inspectActiveLayerIdentity());
  };
  const schedule = (): void => {
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = undefined;
      refresh();
    }, 80);
  };
  const listener = (): void => schedule();
  const focusListener = (): void => schedule();
  const registration = runOptionalPromise(
    () => action.addNotificationListener(ACTIVE_LAYER_EVENTS, listener) as unknown as void | Promise<void>
  );
  window.addEventListener("focus", focusListener);
  refresh();

  return () => {
    disposed = true;
    if (timer !== undefined) window.clearTimeout(timer);
    window.removeEventListener("focus", focusListener);
    void registration.then(() =>
      runOptionalPromise(
        () => action.removeNotificationListener(ACTIVE_LAYER_EVENTS, listener) as unknown as void | Promise<void>
      )
    );
  };
}

function collectionContainsLayerId(
  collection: LayerCollectionLike | undefined,
  layerId: number
): boolean {
  if (!collection) return false;
  for (let index = 0; index < collection.length; index += 1) {
    const layer = collection[index];
    if (!layer) continue;
    if (layer.id === layerId || collectionContainsLayerId(layer.layers, layerId)) return true;
  }
  return false;
}

export function assertActiveLayerSource(source: CenterlinePixelSource): void {
  const current = activeSource();
  if (current.documentId !== source.documentId || current.layerId !== source.layerId) {
    throw new Error("任务执行期间活动文档或图层已改变；已停止写入 Photoshop。");
  }
}

export async function readActiveLayerPixels(): Promise<CenterlinePixelSource> {
  return readLayerPixelsInternal(activeSource(), true);
}

export async function readLayerPixels(source: CenterlineLayerSource): Promise<CenterlinePixelSource> {
  if (!app.documents?.length) throw new Error("请先打开 Photoshop 文档。");
  if (app.activeDocument.id !== source.documentId) {
    throw new Error("最近描边结果属于其他 Photoshop 文档，无法复用。");
  }
  return readLayerPixelsInternal(source, false);
}

async function readLayerPixelsInternal(
  source: CenterlineLayerSource,
  requireActiveLayer: boolean
): Promise<CenterlinePixelSource> {
  const imagingApi = imaging ?? imaging_beta;
  if (!imagingApi) throw new Error("当前 Photoshop 不支持 Imaging API。");

  let result: CenterlinePixelSource | null = null;
  try {
    await core.executeAsModal(async () => {
      if (!app.documents?.length || app.activeDocument.id !== source.documentId) {
        throw new Error("读取像素前活动文档已改变。");
      }
      if (requireActiveLayer) {
        const current = activeSource();
        if (current.layerId !== source.layerId) {
          throw new Error("读取像素前活动图层已改变。");
        }
      }
      const imageObject = await imagingApi.getPixels({
        documentID: source.documentId,
        layerID: source.layerId,
        colorSpace: "RGB",
        componentSize: 8,
        applyAlpha: false
      }) as unknown as PixelResult;
      try {
        const raw = await imageObject.imageData.getData({ chunky: true });
        const bytes = raw instanceof Uint8Array ? raw : Uint8Array.from(raw);
        const level = Number(imageObject.level ?? 0);
        const coordinateScale = 2 ** level;
        const bounds = imageObject.sourceBounds ?? { left: 0, top: 0 };
        result = {
          ...source,
          bytes,
          width: Number(imageObject.imageData.width),
          height: Number(imageObject.imageData.height),
          components: Number(imageObject.imageData.components),
          transform: {
            scaleX: coordinateScale,
            scaleY: coordinateScale,
            offsetX: Number(bounds.left ?? 0) * coordinateScale,
            offsetY: Number(bounds.top ?? 0) * coordinateScale
          }
        };
      } finally {
        imageObject.imageData.dispose();
      }
    }, { commandName: requireActiveLayer ? "AI勾线 · 读取当前图层" : "AI勾线 · 读取来源图层" });
  } catch (error) {
    if (!requireActiveLayer && app.documents?.length && app.activeDocument.id === source.documentId) {
      throw new Error(`无法读取最近描边结果的来源图层“${source.layerName}”；该图层可能已被删除或当前不可读取。`);
    }
    throw error;
  }
  if (!result) {
    throw new Error(requireActiveLayer
      ? "Photoshop 未返回当前图层像素。"
      : "Photoshop 未返回最近描边结果的来源图层像素。");
  }
  return result;
}
