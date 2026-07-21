import { action, app, constants, core } from "photoshop";
import { storage } from "uxp";
import type { CenterlinePixelSource } from "../centerline/types";
import type {
  ImageEditorGeneratedImage,
  ImageEditorInsertPosition,
  ImageEditorReadyResult,
  ImageEditorSourceBounds
} from "../imageEditor/types";
import { deleteTemporaryFile } from "../infrastructure/filesystem/uxpFiles";
import { placeEmbeddedDescriptor, selectLayerDescriptor } from "./actionDescriptors";

interface ImageEditorInsertOptions {
  keepSmartObject: boolean;
  insertPosition: ImageEditorInsertPosition;
}

interface LayerCollectionLike {
  length: number;
  [index: number]: LayerLike;
}

interface LayerLike {
  id: number;
  name: string;
  layers?: LayerCollectionLike;
}

export function sourceBoundsFromPixels(pixels: CenterlinePixelSource): ImageEditorSourceBounds {
  const scaleX = Number(pixels.transform.scaleX);
  const scaleY = Number(pixels.transform.scaleY);
  const left = Number(pixels.transform.offsetX);
  const top = Number(pixels.transform.offsetY);
  const right = left + pixels.width * scaleX;
  const bottom = top + pixels.height * scaleY;
  if (![left, top, right, bottom].every(Number.isFinite) || !(right > left) || !(bottom > top)) {
    throw new Error("AI编辑来源图层边界无效。");
  }
  return { left, top, right, bottom };
}

export async function insertImageEditorResults(
  ready: ImageEditorReadyResult,
  options: ImageEditorInsertOptions,
  onProgress?: (completed: number, total: number) => void
): Promise<void> {
  for (let index = 0; index < ready.images.length; index += 1) {
    await insertImageEditorResult(ready.images[index]!, ready, options);
    onProgress?.(index + 1, ready.images.length);
  }
}

async function insertImageEditorResult(
  image: ImageEditorGeneratedImage,
  ready: ImageEditorReadyResult,
  options: ImageEditorInsertOptions
): Promise<void> {
  if (!app.documents?.length || app.activeDocument.id !== ready.source.documentId) {
    throw new Error(`AI编辑结果属于“${ready.source.documentName}”；请切回来源文档后插入。`);
  }
  if (!findLayerById(app.activeDocument.layers as unknown as LayerCollectionLike, ready.source.layerId)) {
    throw new Error(`AI编辑来源图层“${ready.source.layerName}”已不存在。`);
  }
  const response = await fetch(image.url);
  if (!response.ok) throw new Error(`下载 AI编辑结果失败：HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.byteLength) throw new Error("AI编辑结果文件为空。");
  const extension = extensionFromContentType(response.headers.get("content-type"), image.filename);
  const folder = await storage.localFileSystem.getTemporaryFolder();
  const temporary = await folder.createFile(
    `chess-go-image-edit-${Date.now()}-${safeFileName(image.filename)}.${extension}`,
    { overwrite: true }
  );
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  await temporary.write(copy, { format: storage.formats.binary });

  try {
    const token = storage.localFileSystem.createSessionToken(temporary);
    await core.executeAsModal(async () => {
      if (!app.documents?.length || app.activeDocument.id !== ready.source.documentId) {
        throw new Error("写入 Photoshop 前活动文档已改变。");
      }
      const document = app.activeDocument;
      const sourceLayer = findLayerById(
        document.layers as unknown as LayerCollectionLike,
        ready.source.layerId
      );
      if (!sourceLayer) {
        throw new Error(`AI编辑来源图层“${ready.source.layerName}”已不存在。`);
      }
      await action.batchPlay([selectLayerDescriptor(ready.source.layerId)], {});
      await action.batchPlay([placeEmbeddedDescriptor(token)], {});
      const placedLayer = document.activeLayers?.[0];
      if (!placedLayer) throw new Error("Photoshop 置入 AI编辑结果后没有返回图层。");
      placedLayer.name = `AI编辑 ${ready.workflowVersion.toUpperCase()}`;
      const placedLayerId = placedLayer.id;

      if (options.insertPosition === "above") {
        // `placeEvent` does not reliably preserve the selected layer's parent
        // when that source is nested in an artboard or group. An explicit DOM
        // move both adopts the same parent and positions the result immediately
        // above the exact source layer in Photoshop's layer panel.
        await placedLayer.move(sourceLayer as never, constants.ElementPlacement.PLACEBEFORE);
      } else {
        const topLayer = document.layers?.[0];
        if (topLayer && topLayer.id !== placedLayer.id) {
          await placedLayer.move(topLayer, constants.ElementPlacement.PLACEBEFORE);
        }
      }
      const positionedLayer = findLayerById(
        document.layers as unknown as LayerCollectionLike,
        placedLayerId
      );
      if (!isTransformableLayer(positionedLayer)) {
        throw new Error("AI编辑结果已置入，但无法在目标画板或图层组中重新定位。");
      }
      // Moving into an artboard can change the layer coordinate context. Fit
      // only after the hierarchy is final so the visual result matches the
      // original source bounds.
      await fitLayerInsideBounds(positionedLayer, ready.sourceBounds);
      if (!options.keepSmartObject) {
        await action.batchPlay([{
          _obj: "rasterizeLayer",
          _target: [{ _ref: "layer", _id: placedLayerId }],
          _options: { dialogOptions: "dontDisplay" }
        }], {});
      }
    }, { commandName: `AI编辑 · 插入 ${ready.workflowVersion.toUpperCase()} 结果` });
  } finally {
    await deleteTemporaryFile(temporary);
  }
}

async function fitLayerInsideBounds(
  layer: {
    boundsNoEffects: { left: number; top: number; right: number; bottom: number };
    bounds: { left: number; top: number; right: number; bottom: number };
    scale: Function;
    translate: Function;
  },
  target: ImageEditorSourceBounds
): Promise<void> {
  const source = numericBounds(layer.boundsNoEffects ?? layer.bounds);
  const sourceWidth = source.right - source.left;
  const sourceHeight = source.bottom - source.top;
  const targetWidth = target.right - target.left;
  const targetHeight = target.bottom - target.top;
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) throw new Error("AI编辑结果图层边界为空。");
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  if (Math.abs(scale - 1) > 0.0001) {
    await layer.scale(scale * 100, scale * 100, constants.AnchorPosition.MIDDLECENTER);
  }
  const fitted = numericBounds(layer.boundsNoEffects ?? layer.bounds);
  const fittedCenterX = (fitted.left + fitted.right) / 2;
  const fittedCenterY = (fitted.top + fitted.bottom) / 2;
  await layer.translate(
    (target.left + target.right) / 2 - fittedCenterX,
    (target.top + target.bottom) / 2 - fittedCenterY
  );
}

function findLayerById(collection: LayerCollectionLike | undefined, layerId: number): LayerLike | null {
  if (!collection) return null;
  for (let index = 0; index < collection.length; index += 1) {
    const layer = collection[index];
    if (!layer) continue;
    if (layer.id === layerId) return layer;
    const nested = findLayerById(layer.layers, layerId);
    if (nested) return nested;
  }
  return null;
}

function isTransformableLayer(layer: LayerLike | null): layer is LayerLike & {
  boundsNoEffects: { left: number; top: number; right: number; bottom: number };
  bounds: { left: number; top: number; right: number; bottom: number };
  scale: Function;
  translate: Function;
} {
  if (!layer) return false;
  const candidate = layer as LayerLike & {
    boundsNoEffects?: unknown;
    bounds?: unknown;
    scale?: unknown;
    translate?: unknown;
  };
  return Boolean(
    (candidate.boundsNoEffects || candidate.bounds)
    && typeof candidate.scale === "function"
    && typeof candidate.translate === "function"
  );
}

function numericBounds(bounds: { left: number; top: number; right: number; bottom: number }) {
  return {
    left: Number(bounds.left),
    top: Number(bounds.top),
    right: Number(bounds.right),
    bottom: Number(bounds.bottom)
  };
}

function extensionFromContentType(contentType: string | null, filename: string): string {
  const normalized = contentType?.toLowerCase() ?? "";
  if (normalized.includes("jpeg")) return "jpg";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("png")) return "png";
  const suffix = /\.([a-z0-9]{2,5})$/i.exec(filename)?.[1]?.toLowerCase();
  return suffix || "png";
}

function safeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(-80) || "result";
}
