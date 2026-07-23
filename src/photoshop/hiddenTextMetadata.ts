import { action, constants } from "photoshop";
import { setLayerGroupExpandedDescriptor } from "./actionDescriptors";

export interface HiddenTextLayerLike {
  id: number;
  name: string;
  visible: boolean;
  parent?: HiddenTextLayerLike | null;
  layers?: HiddenTextLayerCollectionLike;
  textItem?: { contents: string };
  move(relativeObject: HiddenTextLayerLike, placement: string): void | Promise<void>;
}

export interface HiddenTextLayerCollectionLike {
  length: number;
  [index: number]: HiddenTextLayerLike;
}

export interface HiddenTextDocumentLike {
  layers: HiddenTextLayerCollectionLike;
  createLayerGroup(options?: { name?: string }): Promise<HiddenTextLayerLike | null>;
  createTextLayer?(options?: {
    name?: string;
    contents?: string;
    fontSize?: number;
    opacity?: number;
    position?: { x: number; y: number };
  }): Promise<HiddenTextLayerLike | null>;
}

export interface HiddenTextMetadataSpec {
  groupName: string;
  layerName: string;
  contentPrefix: string;
}

export interface HiddenTextMetadataEntry {
  group: HiddenTextLayerLike;
  layer: HiddenTextLayerLike;
  contents: string;
}

export function collectionValues(
  collection: HiddenTextLayerCollectionLike | undefined
): HiddenTextLayerLike[] {
  if (!collection) return [];
  const values: HiddenTextLayerLike[] = [];
  for (let index = 0; index < collection.length; index += 1) {
    const layer = collection[index];
    if (layer) values.push(layer);
  }
  return values;
}

export function findTopLevelLayerByName(
  document: HiddenTextDocumentLike,
  name: string
): HiddenTextLayerLike | undefined {
  return collectionValues(document.layers).find((layer) => layer.name === name);
}

export function findHiddenTextMetadataEntry(
  document: HiddenTextDocumentLike,
  spec: HiddenTextMetadataSpec
): HiddenTextMetadataEntry | undefined {
  const group = findTopLevelLayerByName(document, spec.groupName);
  if (!group) return undefined;
  for (const layer of collectionValues(group.layers)) {
    if (!layer.textItem) continue;
    const contents = layer.textItem.contents;
    if (layer.name === spec.layerName || contents.startsWith(spec.contentPrefix)) {
      return { group, layer, contents };
    }
  }
  return undefined;
}

export async function createHiddenTextMetadataLayer(
  document: HiddenTextDocumentLike,
  group: HiddenTextLayerLike,
  spec: HiddenTextMetadataSpec,
  contents: string
): Promise<HiddenTextLayerLike> {
  if (typeof document.createTextLayer !== "function") {
    throw new Error("当前 Photoshop 版本不支持隐藏文本元数据层。");
  }
  const layer = await document.createTextLayer({
    name: spec.layerName,
    contents,
    fontSize: 1,
    opacity: 0,
    position: { x: 0, y: 0 }
  });
  if (!layer) throw new Error("Photoshop 未能创建隐藏文本元数据层。");
  layer.visible = false;
  if (layer.parent?.id !== group.id) {
    await layer.move(group, constants.ElementPlacement.PLACEINSIDE);
  }
  updateHiddenTextMetadataLayer(layer, spec, contents);
  return layer;
}

export function updateHiddenTextMetadataLayer(
  layer: HiddenTextLayerLike,
  spec: HiddenTextMetadataSpec,
  contents: string
): void {
  if (!layer.textItem) throw new Error("隐藏元数据层不是可写文本图层。");
  layer.textItem.contents = contents;
  // Photoshop can rename a newly-created text layer to its initial contents.
  layer.name = spec.layerName;
  layer.visible = false;
}

export async function ensureHiddenTextMetadataGroup(
  document: HiddenTextDocumentLike,
  spec: HiddenTextMetadataSpec
): Promise<HiddenTextLayerLike> {
  const existing = findTopLevelLayerByName(document, spec.groupName);
  if (existing) return existing;
  const group = await document.createLayerGroup({ name: spec.groupName });
  if (!group) throw new Error("Photoshop 未能创建隐藏元数据组。");
  group.name = spec.groupName;
  group.visible = false;
  return group;
}

export async function collapseHiddenTextMetadataGroup(groupId: number): Promise<void> {
  const [result] = await action.batchPlay(
    [setLayerGroupExpandedDescriptor(groupId, false)],
    {}
  ) as Array<{ _obj?: string; result?: number; message?: string }>;
  if (result?._obj?.toLowerCase() !== "error" || result.result === 0) return;
  throw new Error(`Photoshop 未能折叠文档数据组：${result.message || `错误 ${result.result ?? "未知"}`}`);
}

export function moveHiddenTextMetadataGroupToBottom(
  document: HiddenTextDocumentLike,
  group: HiddenTextLayerLike
): void {
  const otherTopLayers = collectionValues(document.layers).filter((layer) => layer.id !== group.id);
  const bottom = otherTopLayers[otherTopLayers.length - 1];
  if (bottom) group.move(bottom, constants.ElementPlacement.PLACEAFTER);
}
