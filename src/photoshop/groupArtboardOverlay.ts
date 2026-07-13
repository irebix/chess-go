import { action, constants } from "photoshop";
import type { LayoutResult } from "../domain/layout";
import type { SheetGroup } from "../domain/models";
import { makeArtboardDescriptor } from "./actionDescriptors";

const GROUP_ARTBOARD_DATA_CONTAINER_NAME = "棋子归档｜分组画板数据";
const GROUP_ARTBOARD_DATA_PREFIX = "分组画板数据｜";

const CANVAS_MARGIN_X = 68;
const CANVAS_MARGIN_Y = 48;
const ARTBOARD_PADDING_X = 44;
const ARTBOARD_PADDING_TOP = 34;
const ARTBOARD_PADDING_BOTTOM = 32;
const CUSTOM_ARTBOARD_BACKGROUND = 4;
const GROUP_ARTBOARD_BACKGROUND_COLOR = 36;

interface LayerLike {
  id: number;
  name: string;
  visible: boolean;
  parent?: LayerLike | null;
  layers?: LayerCollectionLike;
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
  createLayer(options?: { name?: string }): Promise<LayerLike | null>;
  createLayerGroup(options?: { name?: string }): Promise<LayerLike | null>;
}

interface GroupArtboardBounds {
  label: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface StoredGroupArtboard {
  version: 1;
  artboardId: number;
  label: string;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface GroupArtboardOverlayState {
  available: boolean;
  visible: boolean;
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
  selectedGroups: SheetGroup[]
): Promise<void> {
  const document = documentValue as DocumentLike;
  const specifications = groupArtboardBounds(layout, selectedGroups);
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

  for (const entry of created) {
    const dataLayer = await document.createLayer({
      name: serializeSpecification(entry.specification, entry.artboard.id)
    });
    if (!dataLayer) throw new Error(`Photoshop 未能保存分组数据：${entry.specification.label}`);
    dataLayer.visible = false;
    if (dataLayer.parent?.id !== container.id) {
      dataLayer.move(container, constants.ElementPlacement.PLACEINSIDE);
    }
  }

  container.visible = false;
  moveLayerToBottom(document, container);
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
  const artboardSettings = {
    _obj: "artboard",
    color: rgbColor(GROUP_ARTBOARD_BACKGROUND_COLOR),
    artboardBackgroundType: CUSTOM_ARTBOARD_BACKGROUND
  };
  const editById = {
    _obj: "editArtboardEvent",
    _target: [{ _ref: "layer", _id: artboardId }],
    artboard: artboardSettings,
    changeBackground: 1,
    _options: { dialogOptions: "dontDisplay" }
  };
  try {
    await action.batchPlay([editById], {});
  } catch {
    await action.batchPlay([{
      ...editById,
      _target: [{ _ref: "layer", _enum: "ordinal", _value: "targetEnum" }]
    }], {});
  }
}

function groupArtboardBounds(layout: LayoutResult, selectedGroups: SheetGroup[]): GroupArtboardBounds[] {
  const boundsByGroup = new Map<string, GroupArtboardBounds>();

  for (const placement of layout.placements) {
    const sourceGroup = selectedGroups.find((group) => itemBelongsToGroup(placement.item.codeRow, group));
    const groupId = sourceGroup?.id ?? placement.item.sourceGroupId;
    const label = sourceGroup?.label ?? groupId;
    const existing = boundsByGroup.get(groupId);
    if (existing) {
      existing.left = Math.min(existing.left, placement.rect.left - ARTBOARD_PADDING_X);
      existing.top = Math.min(existing.top, placement.rect.top - ARTBOARD_PADDING_TOP);
      existing.right = Math.max(existing.right, placement.rect.right + ARTBOARD_PADDING_X);
      existing.bottom = Math.max(existing.bottom, placement.rect.bottom + ARTBOARD_PADDING_BOTTOM);
    } else {
      boundsByGroup.set(groupId, {
        label,
        left: placement.rect.left - ARTBOARD_PADDING_X,
        top: placement.rect.top - ARTBOARD_PADDING_TOP,
        right: placement.rect.right + ARTBOARD_PADDING_X,
        bottom: placement.rect.bottom + ARTBOARD_PADDING_BOTTOM
      });
    }
  }

  return Array.from(boundsByGroup.values());
}

function serializeSpecification(specification: GroupArtboardBounds, artboardId: number): string {
  const stored: StoredGroupArtboard = {
    version: 1,
    artboardId,
    label: specification.label,
    left: specification.left,
    top: specification.top,
    right: specification.right,
    bottom: specification.bottom
  };
  return `${GROUP_ARTBOARD_DATA_PREFIX}${JSON.stringify(stored)}`;
}

function readStoredSpecifications(document: DocumentLike): StoredGroupArtboard[] {
  const container = findDataContainer(document);
  if (!container) return [];

  const specifications: StoredGroupArtboard[] = [];
  for (const layer of collectionValues(container.layers)) {
    if (!layer.name.startsWith(GROUP_ARTBOARD_DATA_PREFIX)) continue;
    try {
      const value = JSON.parse(layer.name.slice(GROUP_ARTBOARD_DATA_PREFIX.length)) as Partial<StoredGroupArtboard>;
      if (
        value.version === 1 &&
        Number.isInteger(value.artboardId) &&
        Number(value.artboardId) > 0 &&
        typeof value.label === "string" &&
        isFiniteNumber(value.left) &&
        isFiniteNumber(value.top) &&
        isFiniteNumber(value.right) &&
        isFiniteNumber(value.bottom)
      ) {
        specifications.push(value as StoredGroupArtboard);
      }
    } catch {
      // Ignore damaged metadata layers and keep reading the remaining groups.
    }
  }
  return specifications;
}

function findDataContainer(document: DocumentLike): LayerLike | undefined {
  return collectionValues(document.layers).find((layer) => layer.name === GROUP_ARTBOARD_DATA_CONTAINER_NAME);
}

function findGroupArtboards(
  document: DocumentLike,
  specifications: StoredGroupArtboard[]
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

function rgbColor(value: number): { _obj: "RGBColor"; red: number; grain: number; blue: number } {
  return { _obj: "RGBColor", red: value, grain: value, blue: value };
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
