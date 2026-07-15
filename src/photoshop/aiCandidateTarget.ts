const EDITABLE_CANVAS_LAYER_PATTERN = /^\d+x\d+_空白智能对象$/;

export interface CandidateTargetLayer {
  id: number;
  name: string;
  layers?: CandidateTargetLayerCollection;
}

export interface CandidateTargetLayerCollection {
  length: number;
  [index: number]: CandidateTargetLayer;
}

export interface CandidateTargetDocument {
  layers: CandidateTargetLayerCollection;
  artboards?: CandidateTargetLayerCollection;
}

export function isEditableCanvasLayerName(name: string): boolean {
  return EDITABLE_CANVAS_LAYER_PATTERN.test(name);
}

export function findEditableCanvasLayer(
  document: CandidateTargetDocument,
  assetCode: string
): CandidateTargetLayer | undefined {
  const topLayers = collectionValues(document.artboards ?? document.layers);
  const artboard = topLayers.find((layer) => layer.name === assetCode)
    ?? collectionValues(document.layers).find((layer) => layer.name === assetCode);
  if (!artboard) return undefined;
  return allLayers(artboard.layers).find((layer) => isEditableCanvasLayerName(layer.name));
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
