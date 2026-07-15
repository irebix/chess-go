const EDITABLE_CANVAS_LAYER_PATTERN = /^\d+x\d+_空白智能对象$/;

export interface CandidateTargetLayer {
  id: number;
  name: string;
  layers?: CandidateTargetLayerCollection;
  scale?: (horizontal: number, vertical: number, anchor: unknown) => Promise<void>;
  translate?: (horizontal: number, vertical: number) => Promise<void>;
}

export interface CandidateTargetLayerCollection {
  length: number;
  [index: number]: CandidateTargetLayer;
}

export interface CandidateTargetDocument {
  layers: CandidateTargetLayerCollection;
  artboards?: CandidateTargetLayerCollection;
}

export interface EditableCanvasTarget {
  artboard: CandidateTargetLayer;
  layer: CandidateTargetLayer;
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
  const topLayers = collectionValues(document.artboards ?? document.layers);
  const artboard = topLayers.find((layer) => layer.name === assetCode)
    ?? collectionValues(document.layers).find((layer) => layer.name === assetCode);
  if (!artboard) return undefined;
  const layer = allLayers(artboard.layers).find((candidate) => isEditableCanvasLayerName(candidate.name));
  return layer ? { artboard, layer } : undefined;
}

function allLayers(collection: CandidateTargetLayerCollection | undefined): CandidateTargetLayer[] {
  const values = collectionValues(collection);
  return values.flatMap((layer) => [layer, ...allLayers(layer.layers)]);
}

function collectionValues(collection: CandidateTargetLayerCollection | undefined): CandidateTargetLayer[] {
  if (!collection) return [];
  return Array.from({ length: collection.length }, (_, index) => collection[index]).filter(
    (layer): layer is CandidateTargetLayer => Boolean(layer)
  );
}
