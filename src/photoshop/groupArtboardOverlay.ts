import { action, constants } from "photoshop";
import type { LayoutResult } from "../domain/layout";
import type { SheetGroup } from "../domain/models";
import {
  GROUP_LAYOUT_METADATA_TEXT_PREFIX,
  parseGroupLayoutMetadata,
  serializeGroupLayoutMetadata,
  type GroupLayoutBackground,
  type GroupLayoutMetadata,
  type GroupLayoutMetadataGroup,
  type NumericRect
} from "../domain/groupLayoutMetadata";
import {
  makeArtboardBackgroundBatchDescriptors,
  makeArtboardDescriptor,
  setLayerGroupExpandedDescriptor
} from "./actionDescriptors";

const GROUP_ARTBOARD_DATA_CONTAINER_NAME = "棋子归档｜分组画板数据";
const GROUP_ARTBOARD_SINGLE_DATA_LAYER_NAME = "棋子go｜布局数据（请勿删除）";

const CANVAS_MARGIN_X = 68;
const CANVAS_MARGIN_Y = 48;
const ARTBOARD_PADDING_X = 44;
const ARTBOARD_PADDING_TOP = 34;
const ARTBOARD_PADDING_BOTTOM = 32;
const GROUP_ARTBOARD_BACKGROUND_COLOR = 36;

export const GROUP_ARTBOARD_PADDING = {
  left: ARTBOARD_PADDING_X,
  top: ARTBOARD_PADDING_TOP,
  right: ARTBOARD_PADDING_X,
  bottom: ARTBOARD_PADDING_BOTTOM
} as const;

interface LayerLike {
  id: number;
  name: string;
  visible: boolean;
  parent?: LayerLike | null;
  layers?: LayerCollectionLike;
  textItem?: { contents: string };
  move(relativeObject: LayerLike, placement: string): void;
  delete(): Promise<void>;
}

interface LayerCollectionLike {
  length: number;
  [index: number]: LayerLike;
}

interface DocumentLike {
  layers: LayerCollectionLike;
  activeLayers: LayerLike[];
  createLayerGroup(options?: { name?: string }): Promise<LayerLike | null>;
  createTextLayer?(options?: {
    name?: string;
    contents?: string;
    fontSize?: number;
    opacity?: number;
    position?: { x: number; y: number };
  }): Promise<LayerLike | null>;
}

interface SingleMetadataEntry {
  dataLayer: LayerLike;
  metadata: GroupLayoutMetadata;
}

interface GroupArtboardBounds {
  groupId: string;
  label: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
  members: StoredItemArtboard[];
}

export interface StoredItemArtboard {
  artboardId: number;
  row: number;
  col: number;
  name?: string;
}

export interface GroupArtboardOverlayState {
  available: boolean;
  visible: boolean;
}

export interface GeneratedArtboardBackgroundState extends GroupLayoutBackground {
  artboardIds: number[];
}

export function addGroupArtboardCanvasMargin(layout: LayoutResult): LayoutResult {
  return {
    ...layout,
    width: layout.width + CANVAS_MARGIN_X * 2,
    height: layout.height + CANVAS_MARGIN_Y * 2,
    placements: layout.placements.map((placement) => ({
      ...placement,
      rect: {
        left: placement.rect.left + CANVAS_MARGIN_X,
        top: placement.rect.top + CANVAS_MARGIN_Y,
        right: placement.rect.right + CANVAS_MARGIN_X,
        bottom: placement.rect.bottom + CANVAS_MARGIN_Y
      }
    }))
  };
}

export async function initializeGroupArtboardOverlay(
  documentValue: unknown,
  layout: LayoutResult,
  selectedGroups: SheetGroup[],
  itemArtboardIds: number[],
  background: GroupLayoutBackground
): Promise<void> {
  const document = documentValue as DocumentLike;
  const specifications = groupArtboardBounds(layout, selectedGroups, itemArtboardIds);
  if (!specifications.length) return;

  const created: Array<{ specification: GroupArtboardBounds; artboard: LayerLike }> = [];
  try {
    for (const specification of specifications) {
      const artboard = await createGroupArtboard(document, specification);
      artboard.visible = false;
      created.push({ specification, artboard });
    }
  } catch (error) {
    for (const entry of created) {
      try {
        await entry.artboard.delete();
      } catch {
        // Preserve the original creation error.
      }
    }
    throw error;
  }

  const container = await document.createLayerGroup({ name: GROUP_ARTBOARD_DATA_CONTAINER_NAME });
  if (!container) throw new Error("Photoshop 未能保存分组画板数据。");

  const spacing = currentLayoutSpacing(layout);
  const dataLayer = await createSingleMetadataLayer(
    document,
    container,
    metadataGroupsFromCreated(created),
    spacing,
    background
  );

  moveLayerToBottom(document, container);
  // Moving layers can refresh their host state, so enforce invisibility last.
  dataLayer.visible = false;
  container.visible = false;
  await collapseDataContainer(container.id);
}

export function inspectGroupArtboardOverlay(documentValue: unknown): GroupArtboardOverlayState {
  const document = documentValue as DocumentLike;
  const specifications = readStoredSpecifications(document);
  const groupArtboards = findGroupArtboards(document, specifications);
  return {
    available: specifications.length > 0,
    visible: groupArtboards.some((artboard) => artboard.visible)
  };
}

export function readStoredGroupLayout(
  documentValue: unknown
): GroupLayoutMetadataGroup[] {
  return readStoredSpecifications(documentValue as DocumentLike).map((group) => ({
    artboardId: group.artboardId,
    label: group.label,
    rect: { ...group.rect },
    members: group.members.map((member) => ({ ...member }))
  }));
}

export async function showGroupArtboards(documentValue: unknown): Promise<void> {
  const document = documentValue as DocumentLike;
  const specifications = readStoredSpecifications(document);
  if (!specifications.length) throw new Error("当前 PSD 中缺少可恢复的分组画板数据。");
  const groupArtboards = findGroupArtboards(document, specifications);
  if (!groupArtboards.length) throw new Error("当前 PSD 中的分组画板已被删除。");
  for (const artboard of groupArtboards) artboard.visible = true;
}

export async function hideGroupArtboards(documentValue: unknown): Promise<void> {
  const document = documentValue as DocumentLike;
  const specifications = readStoredSpecifications(document);
  for (const artboard of findGroupArtboards(document, specifications)) artboard.visible = false;
}

export function readGeneratedArtboardBackground(
  documentValue: unknown
): GeneratedArtboardBackgroundState | undefined {
  const single = readSingleMetadataEntry(documentValue as DocumentLike);
  if (!single) return undefined;
  return {
    artboardIds: single.metadata.groups.flatMap((group) =>
      group.members.map((member) => member.artboardId)
    ),
    color: { ...single.metadata.background.color },
    visible: single.metadata.background.visible
  };
}

export function writeGeneratedArtboardBackground(
  documentValue: unknown,
  background: GroupLayoutBackground
): void {
  const single = readSingleMetadataEntry(documentValue as DocumentLike);
  if (!single) throw new Error("当前 PSD 中没有新版底板设置数据。");
  writeSingleMetadataLayer(
    single.dataLayer,
    single.metadata.groups,
    single.metadata.spacing,
    background
  );
}

async function createSingleMetadataLayer(
  document: DocumentLike,
  container: LayerLike,
  groups: GroupLayoutMetadataGroup[],
  spacing: number,
  background: GroupLayoutBackground
): Promise<LayerLike> {
  if (typeof document.createTextLayer !== "function") {
    throw new Error("当前 Photoshop 版本不支持单层布局数据。");
  }
  const contents = serializeGroupLayoutMetadata(groups, spacing, background);
  const dataLayer = await document.createTextLayer({
    name: GROUP_ARTBOARD_SINGLE_DATA_LAYER_NAME,
    contents,
    fontSize: 1,
    opacity: 0,
    position: { x: 0, y: 0 }
  });
  if (!dataLayer) throw new Error("Photoshop 未能创建布局数据层。");
  dataLayer.visible = false;
  if (dataLayer.parent?.id !== container.id) {
    dataLayer.move(container, constants.ElementPlacement.PLACEINSIDE);
  }
  writeSingleMetadataLayer(dataLayer, groups, spacing, background);
  return dataLayer;
}

function writeSingleMetadataLayer(
  dataLayer: LayerLike,
  groups: GroupLayoutMetadataGroup[],
  spacing: number,
  background: GroupLayoutBackground
): void {
  if (!dataLayer.textItem) throw new Error("布局数据层不是可写文本图层。");
  const contents = serializeGroupLayoutMetadata(groups, spacing, background);
  if (!parseGroupLayoutMetadata(contents)) {
    throw new Error("棋子go 未能生成有效的布局数据。");
  }
  dataLayer.textItem.contents = contents;
  // Photoshop may rename a newly-created text layer to its contents.
  dataLayer.name = GROUP_ARTBOARD_SINGLE_DATA_LAYER_NAME;
  dataLayer.visible = false;
}

function metadataGroupsFromCreated(
  entries: Array<{ specification: GroupArtboardBounds; artboard: LayerLike }>
): GroupLayoutMetadataGroup[] {
  return entries.map(({ specification, artboard }) => ({
    artboardId: artboard.id,
    label: specification.label,
    rect: {
      left: specification.left,
      top: specification.top,
      right: specification.right,
      bottom: specification.bottom
    },
    members: specification.members.map((member) => ({ ...member }))
  }));
}

export function groupArtboardRectForMemberRects(rects: NumericRect[]): NumericRect {
  if (!rects.length) throw new Error("分组框中没有可用的棋子画板。");
  return {
    left: Math.min(...rects.map((rect) => rect.left)) - ARTBOARD_PADDING_X,
    top: Math.min(...rects.map((rect) => rect.top)) - ARTBOARD_PADDING_TOP,
    right: Math.max(...rects.map((rect) => rect.right)) + ARTBOARD_PADDING_X,
    bottom: Math.max(...rects.map((rect) => rect.bottom)) + ARTBOARD_PADDING_BOTTOM
  };
}

async function createGroupArtboard(
  document: DocumentLike,
  specification: GroupArtboardBounds
): Promise<LayerLike> {
  const beforeIds = new Set(allLayers(document.layers).map((layer) => layer.id));
  await action.batchPlay([makeArtboardDescriptor(specification.label, specification)], {});

  const artboard = allLayers(document.layers).find((layer) => !beforeIds.has(layer.id)) ?? document.activeLayers[0];
  if (!artboard || beforeIds.has(artboard.id)) {
    throw new Error(`Photoshop 未能创建分组画板：${specification.label}`);
  }

  try {
    await setArtboardBackground(artboard.id);
    moveLayerToBottom(document, artboard);
    return artboard;
  } catch (error) {
    try {
      await artboard.delete();
    } catch {
      // Preserve the original error if Photoshop also rejects cleanup.
    }
    throw error;
  }
}

async function setArtboardBackground(artboardId: number): Promise<void> {
  const results = await action.batchPlay(
    makeArtboardBackgroundBatchDescriptors(
      [artboardId],
      {
        red: GROUP_ARTBOARD_BACKGROUND_COLOR,
        green: GROUP_ARTBOARD_BACKGROUND_COLOR,
        blue: GROUP_ARTBOARD_BACKGROUND_COLOR
      }
    ),
    {}
  ) as Array<{ _obj?: string; result?: number; message?: string }>;
  const failure = results.find((result) => result?._obj?.toLowerCase() === "error" && result.result !== 0);
  if (!failure) return;
  throw new Error(`设置分组框底色失败：${failure.message || `错误 ${failure.result ?? "未知"}`}`);
}

function groupArtboardBounds(
  layout: LayoutResult,
  selectedGroups: SheetGroup[],
  itemArtboardIds: number[]
): GroupArtboardBounds[] {
  const boundsByGroup = new Map<string, GroupArtboardBounds>();

  for (let index = 0; index < layout.placements.length; index += 1) {
    const placement = layout.placements[index]!;
    const itemArtboardId = itemArtboardIds[index];
    if (!Number.isInteger(itemArtboardId)) {
      throw new Error(`缺少棋子画板布局数据：${placement.item.assetCode || index + 1}`);
    }
    const sourceGroup = selectedGroups.find((group) => itemBelongsToGroup(placement.item.codeRow, group));
    const groupId = sourceGroup?.id ?? placement.item.sourceGroupId;
    const label = sourceGroup?.label ?? groupId;
    const itemName = placement.item.name?.trim();
    const member = {
      artboardId: itemArtboardId!,
      row: placement.row,
      col: placement.col,
      ...(itemName ? { name: itemName } : {})
    };
    const existing = boundsByGroup.get(groupId);
    if (existing) {
      existing.left = Math.min(existing.left, placement.rect.left - ARTBOARD_PADDING_X);
      existing.top = Math.min(existing.top, placement.rect.top - ARTBOARD_PADDING_TOP);
      existing.right = Math.max(existing.right, placement.rect.right + ARTBOARD_PADDING_X);
      existing.bottom = Math.max(existing.bottom, placement.rect.bottom + ARTBOARD_PADDING_BOTTOM);
      existing.members.push(member);
    } else {
      boundsByGroup.set(groupId, {
        groupId,
        label,
        left: placement.rect.left - ARTBOARD_PADDING_X,
        top: placement.rect.top - ARTBOARD_PADDING_TOP,
        right: placement.rect.right + ARTBOARD_PADDING_X,
        bottom: placement.rect.bottom + ARTBOARD_PADDING_BOTTOM,
        members: [member]
      });
    }
  }

  return Array.from(boundsByGroup.values());
}

function readStoredSpecifications(document: DocumentLike): GroupLayoutMetadataGroup[] {
  return readSingleMetadataEntry(document)?.metadata.groups ?? [];
}

function currentLayoutSpacing(layout: LayoutResult): number {
  const horizontal = layout.placements
    .filter((placement) => placement.col > 0)
    .map((placement) => placement.rect.left)
    .sort((left, right) => left - right);
  if (horizontal.length) {
    const first = layout.placements.find((placement) => placement.col === 0);
    const second = layout.placements.find((placement) => placement.col === 1);
    if (first && second) return Math.max(0, Math.round(second.rect.left - first.rect.right));
  }
  const firstRow = layout.placements.find((placement) => placement.row === 0);
  const secondRow = layout.placements.find((placement) => placement.row === 1);
  return firstRow && secondRow ? Math.max(0, Math.round(secondRow.rect.top - firstRow.rect.bottom)) : 0;
}

function findDataContainer(document: DocumentLike): LayerLike | undefined {
  return collectionValues(document.layers).find((layer) => layer.name === GROUP_ARTBOARD_DATA_CONTAINER_NAME);
}

async function collapseDataContainer(containerId: number): Promise<void> {
  const [result] = await action.batchPlay(
    [setLayerGroupExpandedDescriptor(containerId, false)],
    {}
  ) as Array<{ _obj?: string; result?: number; message?: string }>;
  if (result?._obj?.toLowerCase() !== "error" || result.result === 0) return;
  throw new Error(`Photoshop 未能折叠文档数据组：${result.message || `错误 ${result.result ?? "未知"}`}`);
}

function readSingleMetadataEntry(document: DocumentLike): SingleMetadataEntry | undefined {
  const container = findDataContainer(document);
  if (!container) return undefined;
  for (const layer of collectionValues(container.layers)) {
    if (!layer.textItem) continue;
    const contents = layer.textItem.contents;
    if (
      layer.name !== GROUP_ARTBOARD_SINGLE_DATA_LAYER_NAME &&
      !contents.startsWith(GROUP_LAYOUT_METADATA_TEXT_PREFIX)
    ) {
      continue;
    }
    const metadata = parseGroupLayoutMetadata(contents);
    if (metadata) return { dataLayer: layer, metadata };
  }
  return undefined;
}

function findGroupArtboards(
  document: DocumentLike,
  specifications: Array<{ artboardId: number }>
): LayerLike[] {
  const artboardIds = new Set(specifications.map((specification) => specification.artboardId));
  return allLayers(document.layers).filter((layer) => artboardIds.has(layer.id));
}

function itemBelongsToGroup(row: number, group: SheetGroup): boolean {
  if (!group.physicalSegments.length) return row >= group.startRow && row <= group.endRow;
  return group.physicalSegments.some((segment) => row >= segment.startRow && row <= segment.endRow);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function collectionValues(collection: LayerCollectionLike | undefined): LayerLike[] {
  if (!collection) return [];
  const values: LayerLike[] = [];
  for (let index = 0; index < collection.length; index += 1) {
    const layer = collection[index];
    if (layer) values.push(layer);
  }
  return values;
}

function moveLayerToBottom(document: DocumentLike, layer: LayerLike): void {
  const otherTopLayers = collectionValues(document.layers).filter((candidate) => candidate.id !== layer.id);
  const bottomLayer = otherTopLayers[otherTopLayers.length - 1];
  if (bottomLayer) layer.move(bottomLayer, constants.ElementPlacement.PLACEAFTER);
}

function allLayers(collection: LayerCollectionLike | undefined): LayerLike[] {
  const values: LayerLike[] = [];
  for (const layer of collectionValues(collection)) {
    values.push(layer);
    if (layer.layers?.length) values.push(...allLayers(layer.layers));
  }
  return values;
}
