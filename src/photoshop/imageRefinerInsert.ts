import { action, app, constants, core } from "photoshop";
import { storage } from "uxp";
import type { ImageEditorSourceBounds } from "../imageEditor/types";
import {
  imageRefinerOutputGroupName,
  type ImageRefinerReadyResult
} from "../imageRefiner/types";
import { deleteTemporaryFile } from "../infrastructure/filesystem/uxpFiles";
import { placeEmbeddedDescriptor, selectLayerDescriptor } from "./actionDescriptors";

interface LayerCollectionLike {
  length: number;
  [index: number]: LayerLike;
}

interface LayerLike {
  id: number;
  name: string;
  kind?: string;
  layers?: LayerCollectionLike;
  bounds?: ImageEditorSourceBounds;
  boundsNoEffects?: ImageEditorSourceBounds;
  move(relative: LayerLike, placement: unknown): void | Promise<void>;
  scale?(width: number, height: number, anchor: unknown): Promise<void>;
  translate?(horizontal: number, vertical: number): Promise<void>;
  delete?(): void | Promise<void>;
}

interface TemporaryResult {
  file: storage.File;
  token: string;
}

export async function insertImageRefinerResults(
  ready: ImageRefinerReadyResult,
  onProgress?: (completed: number, total: number) => void
): Promise<void> {
  if (!ready.images.length || ready.images.length !== ready.source.layers.length) {
    throw new Error("AI细化结果数量与来源图层数量不一致，无法安全对应回插。");
  }
  if (!app.documents?.length || app.activeDocument.id !== ready.source.documentId) {
    throw new Error(`AI细化结果属于“${ready.source.documentName}”；请切回来源文档后插入。`);
  }
  const temporaryResults = await downloadTemporaryResults(ready);
  try {
    await core.executeAsModal(async () => {
      if (!app.documents?.length || app.activeDocument.id !== ready.source.documentId) {
        throw new Error("写入 AI细化结果前活动文档已改变。");
      }
      const document = app.activeDocument;
      const sourceGroup = findLayerById(
        document.layers as unknown as LayerCollectionLike,
        ready.source.groupId
      );
      if (!sourceGroup || sourceGroup.kind !== "group") {
        throw new Error(`AI细化来源图层组“${ready.source.groupName}”已不存在。`);
      }
      const missingLayer = ready.source.layers.find((source) => (
        !findLayerById(sourceGroup.layers, source.layerId)
      ));
      if (missingLayer) {
        throw new Error(`AI细化来源图层“${missingLayer.layerName}”已不存在。`);
      }

      let outputGroup: LayerLike | null = null;
      try {
        outputGroup = await document.createLayerGroup({
          name: imageRefinerOutputGroupName(ready.source.groupName)
        } as never) as unknown as LayerLike | null;
        if (!outputGroup) throw new Error("Photoshop 未能创建 AI细化结果图层组。");
        await outputGroup.move(sourceGroup, constants.ElementPlacement.PLACEBEFORE);

        let previousLayerId: number | null = null;
        const placedLayerIds: number[] = [];
        for (let index = 0; index < ready.images.length; index += 1) {
          const source = ready.source.layers[index]!;
          await action.batchPlay([selectLayerDescriptor(source.layerId)], {});
          await action.batchPlay([placeEmbeddedDescriptor(temporaryResults[index]!.token)], {});
          const placedLayer = document.activeLayers?.[0] as unknown as LayerLike | undefined;
          if (!placedLayer) throw new Error("Photoshop 置入 AI细化结果后没有返回图层。");
          placedLayer.name = source.layerName;
          const placedLayerId = placedLayer.id;

          if (previousLayerId === null) {
            await placedLayer.move(outputGroup, constants.ElementPlacement.PLACEINSIDE);
          } else {
            const previousLayer = findLayerById(
              document.layers as unknown as LayerCollectionLike,
              previousLayerId
            );
            if (!previousLayer) throw new Error("AI细化结果图层顺序已被意外改变。");
            await placedLayer.move(previousLayer, constants.ElementPlacement.PLACEAFTER);
          }

          const positionedLayer = findLayerById(
            document.layers as unknown as LayerCollectionLike,
            placedLayerId
          );
          if (!isTransformableLayer(positionedLayer)) {
            throw new Error(`AI细化结果“${source.layerName}”无法重新定位。`);
          }
          await fitLayerInsideBounds(positionedLayer, source.bounds);
          placedLayerIds.push(placedLayerId);
          previousLayerId = placedLayerId;
          onProgress?.(index + 1, ready.images.length);
        }
        await action.batchPlay(placedLayerIds.map((placedLayerId) => ({
            _obj: "rasterizeLayer",
            _target: [{ _ref: "layer", _id: placedLayerId }],
            _options: { dialogOptions: "dontDisplay" }
          })), {});
      } catch (error) {
        if (outputGroup?.delete) {
          try {
            await outputGroup.delete();
          } catch {
            // Preserve the insertion error; the partial group remains recoverable in Photoshop.
          }
        }
        throw error;
      }
    }, { commandName: `AI细化 · 回插 ${ready.images.length} 个图层` });
  } finally {
    await Promise.all(temporaryResults.map(({ file }) => deleteTemporaryFile(file)));
  }
}

async function downloadTemporaryResults(ready: ImageRefinerReadyResult): Promise<TemporaryResult[]> {
  const folder = await storage.localFileSystem.getTemporaryFolder();
  const results: TemporaryResult[] = [];
  try {
    for (let index = 0; index < ready.images.length; index += 1) {
      const image = ready.images[index]!;
      const response = await fetch(image.url);
      if (!response.ok) throw new Error(`下载 AI细化结果失败：HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (!bytes.byteLength) throw new Error("AI细化结果文件为空。");
      const extension = extensionFromContentType(response.headers.get("content-type"), image.filename);
      const file = await folder.createFile(
        `chess-go-refine-${Date.now()}-${String(index + 1).padStart(3, "0")}.${extension}`,
        { overwrite: true }
      );
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      await file.write(copy, { format: storage.formats.binary });
      results.push({
        file,
        token: storage.localFileSystem.createSessionToken(file)
      });
    }
    return results;
  } catch (error) {
    await Promise.all(results.map(({ file }) => deleteTemporaryFile(file)));
    throw error;
  }
}

async function fitLayerInsideBounds(
  layer: LayerLike & {
    boundsNoEffects?: ImageEditorSourceBounds;
    bounds?: ImageEditorSourceBounds;
    scale: (width: number, height: number, anchor: unknown) => Promise<void>;
    translate: (horizontal: number, vertical: number) => Promise<void>;
  },
  target: ImageEditorSourceBounds
): Promise<void> {
  const source = numericBounds(layer.boundsNoEffects ?? layer.bounds);
  const sourceWidth = source.right - source.left;
  const sourceHeight = source.bottom - source.top;
  const targetWidth = target.right - target.left;
  const targetHeight = target.bottom - target.top;
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) throw new Error("AI细化结果图层边界为空。");
  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  if (Math.abs(scale - 1) > 0.0001) {
    await layer.scale(scale * 100, scale * 100, constants.AnchorPosition.MIDDLECENTER);
  }
  const fitted = numericBounds(layer.boundsNoEffects ?? layer.bounds);
  await layer.translate(
    (target.left + target.right - fitted.left - fitted.right) / 2,
    (target.top + target.bottom - fitted.top - fitted.bottom) / 2
  );
}

function findLayerById(
  collection: LayerCollectionLike | undefined,
  layerId: number
): LayerLike | null {
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
  boundsNoEffects?: ImageEditorSourceBounds;
  bounds?: ImageEditorSourceBounds;
  scale: (width: number, height: number, anchor: unknown) => Promise<void>;
  translate: (horizontal: number, vertical: number) => Promise<void>;
} {
  return Boolean(
    layer
    && (layer.boundsNoEffects || layer.bounds)
    && typeof layer.scale === "function"
    && typeof layer.translate === "function"
  );
}

function numericBounds(bounds: ImageEditorSourceBounds | undefined): ImageEditorSourceBounds {
  if (!bounds) throw new Error("AI细化结果图层边界为空。");
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
  return /\.([a-z0-9]{2,5})$/i.exec(filename)?.[1]?.toLowerCase() || "png";
}
