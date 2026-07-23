import { action, app, constants, core } from "photoshop";
import { storage } from "uxp";
import type { CenterlinePixelSource } from "../centerline/types";
import type {
  ImageEditorGeneratedImage,
  ImageEditorInsertPosition,
  ImageEditorReadyResult,
  ImageEditorSourceBounds
} from "../imageEditor/types";
import {
  deleteTemporaryFile,
  downloadTemporaryImage
} from "../infrastructure/filesystem/uxpFiles";
import { placeEmbeddedDescriptor, selectLayerDescriptor } from "./actionDescriptors";
import { alignResultToSource } from "./layerPlacementGeometry";
import { resolvePlacementMode } from "./placementMode";

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
  if (resolvePlacementMode(app.activeDocument) === "UNSUPPORTED_CANVAS") {
    throw new Error("当前不是棋子go标准网格画布，无法自动定位。AI编辑结果已保留。");
  }
  const temporary = await downloadTemporaryImage(image.url, {
    prefix: "chess-go-image-edit",
    fileName: image.filename
  });

  try {
    const token = storage.localFileSystem.createSessionToken(temporary);
    await core.executeAsModal(async () => {
      if (!app.documents?.length || app.activeDocument.id !== ready.source.documentId) {
        throw new Error("写入 Photoshop 前活动文档已改变。");
      }
      if (resolvePlacementMode(app.activeDocument) === "UNSUPPORTED_CANVAS") {
        throw new Error("当前不是棋子go标准网格画布，无法自动定位。AI编辑结果已保留。");
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

      if (options.insertPosition === "top") {
        const topLayer = document.layers?.[0];
        if (topLayer && topLayer.id !== placedLayer.id) {
          await placedLayer.move(topLayer, constants.ElementPlacement.PLACEBEFORE);
        }
      }
      await alignResultToSource(
        document as unknown as Parameters<typeof alignResultToSource>[0],
        placedLayerId,
        ready.source.layerId,
        ready.sourceBounds,
        {
          fit: "contain",
          allowUpscale: true,
          moveAbove: options.insertPosition === "above"
        }
      );
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
