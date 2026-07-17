import type { GroupLayoutMetadataGroup } from "../domain/groupLayoutMetadata";

const EDITABLE_CANVAS_LAYER_PATTERN = /^\d+x\d+_空白智能对象$/;

export interface CandidateTargetLayer {
  id: number;
  name: string;
  layers?: CandidateTargetLayerCollection;
  boundsNoEffects?: CandidateLayerBounds;
  scale?: (horizontal: number, vertical: number, anchor: unknown) => Promise<void>;
  translate?: (horizontal: number, vertical: number) => Promise<void>;
  move?: (relativeObject: unknown, insertionLocation: unknown) => Promise<void>;
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
  activeLayers?: CandidateTargetLayerCollection;
}

export interface EditableCanvasTarget {
  artboard: CandidateTargetLayer;
  layer: CandidateTargetLayer;
  path: CandidateTargetLayer[];
}

export interface PsdAiTargetNode {
  assetCode: string;
  artboardId: number;
  referenceLayerId: number;
  targetLayerId?: number;
  targetIssue?: "missing" | "ambiguous";
}

export interface PsdAiScopedNode extends PsdAiTargetNode {
  groupId: string;
  groupLabel: string;
  groupOrder: number;
  memberRow: number;
  memberCol: number;
  itemName?: string;
}

export function isEditableCanvasLayerName(name: string): boolean {
  return EDITABLE_CANVAS_LAYER_PATTERN.test(name);
}

export function preferredEditableCanvasLayerName(
  document: CandidateTargetDocument,
  fallbackSize: number
): string {
  const counts = new Map<number, number>();
  for (const { layer } of allLayerPaths(document.layers)) {
    const match = /^(\d+)x\1_空白智能对象$/.exec(layer.name);
    if (!match) continue;
    const size = Number(match[1]);
    if (!Number.isInteger(size) || size < 1) continue;
    counts.set(size, (counts.get(size) ?? 0) + 1);
  }
  const preferred = Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0] - right[0])[0]?.[0]
    ?? fallbackSize;
  return `${preferred}x${preferred}_空白智能对象`;
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

export function listUniqueEditableCanvasAssetCodes(
  document: CandidateTargetDocument
): string[] {
  const topLayers = collectionValues(document.artboards ?? document.layers);
  const names = Array.from(new Set(topLayers.map((layer) => layer.name.trim()).filter(Boolean)));
  return names.filter((assetCode) => findEditableCanvasTargets(document, assetCode).length === 1);
}

export function listPsdAiTargetNodes(
  document: CandidateTargetDocument,
  referenceLayerName = "参考图",
  expectedArtboardIds?: readonly number[]
): PsdAiTargetNode[] {
  const expectedIds = expectedArtboardIds ? new Set(expectedArtboardIds) : undefined;
  const artboards = topLevelLayers(document).filter((artboard) =>
    !expectedIds || expectedIds.has(artboard.id)
  );
  const discovered = artboards.flatMap((artboard) => {
    const editableTargets = allLayerPaths(artboard.layers).filter(({ layer }) =>
      isEditableCanvasLayerName(layer.name)
    );
    const children = collectionValues(artboard.layers);
    const exactReferences = children.filter((layer) => layer.name === referenceLayerName);
    const editableLayers = children.filter((layer) => isEditableCanvasLayerName(layer.name));
    const legacyCandidates = children.filter((layer) => !isEditableCanvasLayerName(layer.name));
    const reference = exactReferences.length === 1
      ? exactReferences[0]
      : editableLayers.length === 1 && legacyCandidates.length === 1
        ? legacyCandidates[0]
        : undefined;
    return reference ? [{
      assetCode: artboard.name.trim(),
      artboardId: artboard.id,
      referenceLayerId: reference.id,
      ...(editableTargets.length === 1
        ? { targetLayerId: editableTargets[0]!.layer.id }
        : { targetIssue: editableTargets.length ? "ambiguous" as const : "missing" as const })
    }] : [];
  });
  const assetCodeCounts = new Map<string, number>();
  for (const node of discovered) {
    assetCodeCounts.set(node.assetCode, (assetCodeCounts.get(node.assetCode) ?? 0) + 1);
  }
  return discovered.filter((node) => node.assetCode && assetCodeCounts.get(node.assetCode) === 1);
}

export function scopePsdAiTargetNodes(
  documentId: number,
  nodes: readonly PsdAiTargetNode[],
  groups: readonly GroupLayoutMetadataGroup[]
): PsdAiScopedNode[] {
  const nodesByArtboardId = new Map(nodes.map((node) => [node.artboardId, node]));
  const usedArtboardIds = new Set<number>();
  const scoped = groups.flatMap((group, groupOrder) =>
    [...group.members]
      .sort((left, right) => left.row - right.row || left.col - right.col)
      .flatMap((member) => {
        const node = nodesByArtboardId.get(member.artboardId);
        if (!node || usedArtboardIds.has(node.artboardId)) return [];
        usedArtboardIds.add(node.artboardId);
        return [{
          ...node,
          groupId: `psd:${documentId}:group:${group.artboardId}`,
          groupLabel: group.label,
          groupOrder,
          memberRow: member.row,
          memberCol: member.col,
          ...(member.name ? { itemName: member.name } : {})
        }];
      })
  );
  const fallbackOrder = groups.length;
  for (const node of nodes) {
    if (usedArtboardIds.has(node.artboardId)) continue;
    scoped.push({
      ...node,
      groupId: `psd:${documentId}:ungrouped`,
      groupLabel: "当前 PSD",
      groupOrder: fallbackOrder,
      memberRow: scoped.length,
      memberCol: 0
    });
  }
  return scoped;
}

export function findEditableCanvasTargetByIds(
  document: CandidateTargetDocument,
  artboardId: number,
  layerId: number
): EditableCanvasTarget | undefined {
  const topLayers = collectionValues(document.artboards ?? document.layers);
  const artboard = topLayers.find((layer) => layer.id === artboardId)
    ?? collectionValues(document.layers).find((layer) => layer.id === artboardId);
  if (!artboard) return undefined;

  const nested = allLayerPaths(artboard.layers).find(({ layer }) => layer.id === layerId);
  if (nested) return { artboard, layer: nested.layer, path: nested.path };

  const documentMatch = allLayerPaths(document.layers).find(({ layer }) => layer.id === layerId);
  if (!documentMatch) return undefined;
  const otherArtboardIds = new Set(
    collectionValues(document.artboards)
      .filter((candidate) => candidate.id !== artboardId)
      .map((candidate) => candidate.id)
  );
  if (documentMatch.path.some((candidate) => otherArtboardIds.has(candidate.id))) return undefined;
  return { artboard, layer: documentMatch.layer, path: documentMatch.path };
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

function topLevelLayers(document: CandidateTargetDocument): CandidateTargetLayer[] {
  const layersById = new Map<number, CandidateTargetLayer>();
  for (const layer of collectionValues(document.layers)) layersById.set(layer.id, layer);
  for (const layer of collectionValues(document.artboards)) layersById.set(layer.id, layer);
  return Array.from(layersById.values());
}
