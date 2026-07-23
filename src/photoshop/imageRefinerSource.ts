import { app } from "photoshop";
import type { ImageEditorSourceBounds } from "../imageEditor/types";
import type {
  ImageRefinerLayerKind,
  ImageRefinerLayerSource,
  ImageRefinerSource
} from "../imageRefiner/types";

interface LayerCollectionLike {
  length: number;
  [index: number]: LayerLike;
}

interface LayerLike {
  id: number;
  name: string;
  kind?: string;
  bounds?: ImageEditorSourceBounds;
  boundsNoEffects?: ImageEditorSourceBounds;
  layers?: LayerCollectionLike;
}

export function inspectActiveImageRefinerSource(): ImageRefinerSource | null {
  try {
    if (!app.documents?.length) return null;
    const document = app.activeDocument;
    const activeLayer = document.activeLayers?.[0] as unknown as LayerLike | undefined;
    if (!activeLayer) return null;
    const documentIdentity = {
      documentId: document.id,
      documentName: document.title
    };
    if (activeLayer.kind !== "group") {
      const layer = eligibleLayerSource(activeLayer, documentIdentity);
      if (!layer) return null;
      return {
        ...documentIdentity,
        selectionKind: "layer",
        sourceId: activeLayer.id,
        sourceName: activeLayer.name,
        layers: [layer],
        skippedLayerCount: 0
      };
    }
    const layers: ImageRefinerLayerSource[] = [];
    const skipped = { count: 0 };
    collectEligibleLayers(
      activeLayer.layers,
      documentIdentity,
      layers,
      skipped
    );
    return {
      ...documentIdentity,
      selectionKind: "group",
      sourceId: activeLayer.id,
      sourceName: activeLayer.name,
      layers,
      skippedLayerCount: skipped.count
    };
  } catch {
    return null;
  }
}

export function isImageRefinerSourceAvailable(source: ImageRefinerSource): boolean {
  try {
    const document = app.documents?.find((candidate) => candidate.id === source.documentId);
    if (!document) return false;
    const selected = findLayerById(
      document.layers as unknown as LayerCollectionLike,
      source.sourceId
    );
    if (!selected) return false;
    if (source.selectionKind === "layer") {
      return selected.kind !== "group"
        && source.layers.length === 1
        && source.layers[0]?.layerId === selected.id
        && Boolean(eligibleKind(selected.kind));
    }
    if (selected.kind !== "group") return false;
    return source.layers.every((layer) => Boolean(findLayerById(selected.layers, layer.layerId)));
  } catch {
    return false;
  }
}

function collectEligibleLayers(
  collection: LayerCollectionLike | undefined,
  document: { documentId: number; documentName: string },
  output: ImageRefinerLayerSource[],
  skipped: { count: number }
): void {
  if (!collection) return;
  for (let index = 0; index < collection.length; index += 1) {
    const layer = collection[index];
    if (!layer) continue;
    if (layer.kind === "group") {
      collectEligibleLayers(layer.layers, document, output, skipped);
      continue;
    }
    const source = eligibleLayerSource(layer, document);
    if (!source) {
      skipped.count += 1;
      continue;
    }
    output.push(source);
  }
}

function eligibleLayerSource(
  layer: LayerLike,
  document: { documentId: number; documentName: string }
): ImageRefinerLayerSource | null {
  const kind = eligibleKind(layer.kind);
  const bounds = readBounds(layer);
  if (!kind || !bounds) return null;
  return {
    ...document,
    layerId: layer.id,
    layerName: layer.name,
    kind,
    bounds
  };
}

function eligibleKind(kind: string | undefined): ImageRefinerLayerKind | null {
  if (kind === "pixel") return "pixel";
  if (kind === "smartObject") return "smartObject";
  return null;
}

function readBounds(layer: LayerLike): ImageEditorSourceBounds | null {
  const candidate = layer.boundsNoEffects ?? layer.bounds;
  if (!candidate) return null;
  const bounds = {
    left: Number(candidate.left),
    top: Number(candidate.top),
    right: Number(candidate.right),
    bottom: Number(candidate.bottom)
  };
  if (
    !Object.values(bounds).every(Number.isFinite)
    || !(bounds.right > bounds.left)
    || !(bounds.bottom > bounds.top)
  ) return null;
  return bounds;
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
