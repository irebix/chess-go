import { action, app, constants, core } from "photoshop";
import { storage } from "uxp";
import type { ImageEditorSourceBounds } from "../imageEditor/types";
import { constrainBoundsToPrimaryGridSlot } from "../grid/GridGeometry";
import {
  imageRefinerOutputGroupName,
  imageRefinerOutputLayerName,
  type ImageRefinerReadyResult
} from "../imageRefiner/types";
import { deleteTemporaryFile } from "../infrastructure/filesystem/uxpFiles";
import { placeEmbeddedDescriptor, selectLayerDescriptor } from "./actionDescriptors";
import {
  fitLayerInsideBounds,
  type TransformableLayerLike
} from "./layerPlacementGeometry";
import { resolvePlacementMode } from "./placementMode";

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

export interface ImageRefinerInsertOptions {
  keepSmartObject: boolean;
}

export async function insertImageRefinerResults(
  ready: ImageRefinerReadyResult,
  options: ImageRefinerInsertOptions,
  onProgress?: (completed: number, total: number) => void
): Promise<void> {
  if (!ready.images.length || ready.images.length !== ready.source.layers.length) {
    throw new Error("AI细化结果数量与来源图层数量不一致，无法安全对应回插。");
  }
  if (!app.documents?.length || app.activeDocument.id !== ready.source.documentId) {
    throw new Error(`AI细化结果属于“${ready.source.documentName}”；请切回来源文档后插入。`);
  }
  if (resolvePlacementMode(app.activeDocument) === "UNSUPPORTED_CANVAS") {
    throw new Error("当前不是棋子go标准网格画布，无法自动定位。AI细化结果已保留。");
  }
  const temporaryResults = await downloadTemporaryResults(ready);
  try {
    await core.executeAsModal(async () => {
      if (!app.documents?.length || app.activeDocument.id !== ready.source.documentId) {
        throw new Error("写入 AI细化结果前活动文档已改变。");
      }
      const placementMode = resolvePlacementMode(app.activeDocument);
      if (placementMode === "UNSUPPORTED_CANVAS") {
        throw new Error("当前不是棋子go标准网格画布，无法自动定位。AI细化结果已保留。");
      }
      const document = app.activeDocument;
      const selectedSource = findLayerById(
        document.layers as unknown as LayerCollectionLike,
        ready.source.sourceId
      );
      if (!selectedSource) {
        throw new Error(`AI细化来源${ready.source.selectionKind === "group" ? "图层组" : "图层"}“${ready.source.sourceName}”已不存在。`);
      }
      if (ready.source.selectionKind === "group") {
        if (selectedSource.kind !== "group") {
          throw new Error(`AI细化来源图层组“${ready.source.sourceName}”已不存在。`);
        }
        const missingLayer = ready.source.layers.find((source) => (
          !findLayerById(selectedSource.layers, source.layerId)
        ));
        if (missingLayer) {
          throw new Error(`AI细化来源图层“${missingLayer.layerName}”已不存在。`);
        }
      } else if (
        selectedSource.kind === "group"
        || ready.source.layers.length !== 1
        || ready.source.layers[0]?.layerId !== selectedSource.id
      ) {
        throw new Error(`AI细化来源图层“${ready.source.sourceName}”已改变。`);
      }

      let outputGroup: LayerLike | null = null;
      let singleOutputLayer: LayerLike | null = null;
      try {
        if (ready.source.selectionKind === "group") {
          outputGroup = await document.createLayerGroup({
            name: imageRefinerOutputGroupName(ready.source.sourceName)
          } as never) as unknown as LayerLike | null;
          if (!outputGroup) throw new Error("Photoshop 未能创建 AI细化结果图层组。");
          await outputGroup.move(selectedSource, constants.ElementPlacement.PLACEBEFORE);
        }

        let previousLayerId: number | null = null;
        const placedLayerIds: number[] = [];
        for (let index = 0; index < ready.images.length; index += 1) {
          const source = ready.source.layers[index]!;
          await action.batchPlay([selectLayerDescriptor(source.layerId)], {});
          await action.batchPlay([placeEmbeddedDescriptor(temporaryResults[index]!.token)], {});
          const placedLayer = document.activeLayers?.[0] as unknown as LayerLike | undefined;
          if (!placedLayer) throw new Error("Photoshop 置入 AI细化结果后没有返回图层。");
          placedLayer.name = ready.source.selectionKind === "group"
            ? source.layerName
            : imageRefinerOutputLayerName(source.layerName);
          const placedLayerId = placedLayer.id;

          if (ready.source.selectionKind === "layer") {
            await placedLayer.move(selectedSource, constants.ElementPlacement.PLACEBEFORE);
            singleOutputLayer = placedLayer;
          } else if (previousLayerId === null) {
            await placedLayer.move(outputGroup as LayerLike, constants.ElementPlacement.PLACEINSIDE);
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
          const targetBounds = placementMode === "STANDARD_GRID"
            ? constrainBoundsToPrimaryGridSlot(source.bounds)
            : { bounds: source.bounds };
          if (!targetBounds) {
            throw new Error(`AI细化来源“${source.layerName}”未落在有效标准网格格子内。`);
          }
          await fitLayerInsideBounds(
            positionedLayer as unknown as TransformableLayerLike,
            targetBounds.bounds,
            { allowUpscale: true }
          );
          placedLayerIds.push(placedLayerId);
          previousLayerId = placedLayerId;
          onProgress?.(index + 1, ready.images.length);
        }
        if (!options.keepSmartObject) {
          await action.batchPlay(placedLayerIds.map((placedLayerId) => ({
            _obj: "rasterizeLayer",
            _target: [{ _ref: "layer", _id: placedLayerId }],
            _options: { dialogOptions: "dontDisplay" }
          })), {});
        }
      } catch (error) {
        const cleanupTarget = outputGroup ?? singleOutputLayer;
        if (cleanupTarget?.delete) {
          try {
            await cleanupTarget.delete();
          } catch {
            // Preserve the insertion error; a partial result remains recoverable in Photoshop.
          }
        }
        throw error;
      }
    }, {
      commandName: ready.source.selectionKind === "group"
        ? `AI细化 · 回插 ${ready.images.length} 个图层`
        : "AI细化 · 回插单个图层"
    });
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

function extensionFromContentType(contentType: string | null, filename: string): string {
  const normalized = contentType?.toLowerCase() ?? "";
  if (normalized.includes("jpeg")) return "jpg";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("png")) return "png";
  return /\.([a-z0-9]{2,5})$/i.exec(filename)?.[1]?.toLowerCase() || "png";
}
