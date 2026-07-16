const EDITABLE_CANVAS_LAYER_PATTERN = /^\d+x\d+_空白智能对象$/;

export interface CandidateTargetLayer {
  id: number;
  name: string;
  layers?: CandidateTargetLayerCollection;
  boundsNoEffects?: CandidateLayerBounds;
  scale?: (horizontal: number, vertical: number, anchor: unknown) => Promise<void>;
  translate?: (horizontal: number, vertical: number) => Promise<void>;
}

export interface CandidateLayerBounds {
  left: unknown;
  top: unknown;
  right: unknown;
  bottom: unknown;
}

export interface CandidateTargetLayerCollection {
  length: number;
  [index: number]: CandidateTargetLayer;
}

export interface CandidateTargetDocument {
  id?: number;
  layers: CandidateTargetLayerCollection;
  artboards?: CandidateTargetLayerCollection;
}

export interface EditableCanvasTarget {
  artboard: CandidateTargetLayer;
  layer: CandidateTargetLayer;
  path: CandidateTargetLayer[];
}

export function isEditableCanvasLayerName(name: string): boolean {
  return EDITABLE_CANVAS_LAYER_PATTERN.test(name);
}

export function findEditableCanvasLayer(
  document: CandidateTargetDocument,
  assetCode: string
): CandidateTargetLayer | undefined {
  return findEditableCanvasTarget(document, assetCode)?.layer;
}

export function findEditableCanvasTarget(
  document: CandidateTargetDocument,
  assetCode: string
): EditableCanvasTarget | undefined {
  return findEditableCanvasTargets(document, assetCode)[0];
}

export function findEditableCanvasTargets(
  document: CandidateTargetDocument,
  assetCode: string
): EditableCanvasTarget[] {
  const topLayers = collectionValues(document.artboards ?? document.layers);
  const artboards = topLayers.filter((layer) => layer.name === assetCode);
  const fallbackArtboards = artboards.length
    ? artboards
    : collectionValues(document.layers).filter((layer) => layer.name === assetCode);
  return fallbackArtboards.flatMap((artboard) =>
    allLayerPaths(artboard.layers)
      .filter(({ layer }) => isEditableCanvasLayerName(layer.name))
      .map(({ layer, path }) => ({ artboard, layer, path }))
  );
}

function allLayerPaths(
  collection: CandidateTargetLayerCollection | undefined,
  ancestors: CandidateTargetLayer[] = []
): Array<{ layer: CandidateTargetLayer; path: CandidateTargetLayer[] }> {
  return collectionValues(collection).flatMap((layer) => {
    const path = [...ancestors, layer];
    return [{ layer, path }, ...allLayerPaths(layer.layers, path)];
  });
}

function collectionValues(collection: CandidateTargetLayerCollection | undefined): CandidateTargetLayer[] {
  if (!collection) return [];
  return Array.from({ length: collection.length }, (_, index) => collection[index]).filter(
    (layer): layer is CandidateTargetLayer => Boolean(layer)
  );
}
