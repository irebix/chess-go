import { action, app, constants, core } from "photoshop";
import { storage } from "uxp";
import {
  gridSlotFromId,
  gridSlotAt,
  gridBoundsOccupiesSlot,
  primaryGridSlotForBounds,
  type GridRect
} from "../grid/GridGeometry";
import {
  gridDraftExpectedLayerNames,
  gridDraftGroupName,
  gridDraftGroupRow,
  isGridDraftRefinementGroupName,
  gridDraftLayerName,
  type GridDraftChainItemIdentity
} from "../grid/GridDraftBinding";
import {
  scanGridLayerSnapshots,
  isGridOccupancyExcludedLayer,
  type GridLayerSnapshot,
  type GridOccupancySnapshot
} from "../grid/GridOccupancyScanner";
import {
  findContiguousSlots,
  findFirstEmptyRow,
  findFirstEmptySlot
} from "../grid/GridPlacementPlanner";
import {
  initializeGridMetadataStore,
  readGridMetadataStore,
  type GridMetadataDocumentLike,
  type GridMetadataStoreState
} from "../grid/GridMetadataStore";
import { STANDARD_GRID_TEMPLATE } from "../grid/GridTemplate";
import {
  deleteTemporaryFile,
  downloadTemporaryImage
} from "../infrastructure/filesystem/uxpFiles";
import {
  placeEmbeddedDescriptor,
  replacePlacedLayerContentsDescriptor,
  selectLayerDescriptor
} from "./actionDescriptors";
import {
  assertSingleBatchPlaySucceeded,
  runWithRollbackHistory,
  type HistorySuspensionHostControl
} from "./aiCandidateBackfillSafety";
import {
  alignResultToSource,
  findLayerById,
  fitLayerInsideBounds,
  type TransformableLayerLike
} from "./layerPlacementGeometry";
import { inspectGridCanvas, resolvePlacementMode } from "./placementMode";
import type { HiddenTextLayerLike } from "./hiddenTextMetadata";

interface GridLayerLike extends HiddenTextLayerLike {
  kind?: unknown;
  boundsNoEffects?: GridRect;
  bounds?: GridRect;
  layers?: GridLayerCollectionLike;
  scale(horizontal: number, vertical: number, anchor: unknown): Promise<void> | void;
  translate(horizontal: number, vertical: number): Promise<void> | void;
  move(relativeObject: GridLayerLike, placement: unknown): Promise<void> | void;
  delete?(): Promise<void> | void;
}

interface GridLayerCollectionLike {
  length: number;
  [index: number]: GridLayerLike;
}

interface StandardGridDocumentLike extends GridMetadataDocumentLike {
  id: number;
  name?: string;
  title?: string;
  activeLayers?: GridLayerLike[];
  createLayerGroup(options?: { name?: string }): Promise<GridLayerLike | null>;
}

export interface GridImageInput {
  url: string;
  fileName?: string;
  layerName?: string;
}

export interface GridDraftBindingValid {
  status: "valid";
  row: number;
  rowSlotIds: string[];
  groupId: number | null;
  layerIdsByChainIndex: Record<number, number>;
}

export type GridDraftBindingInspection =
  | { status: "missing" }
  | { status: "invalid"; reason: string }
  | GridDraftBindingValid;

export interface GridDraftUpsertImage extends GridImageInput {
  chainIndex: number;
  assetCode: string;
}

export interface GridDraftUpsertReport {
  completed: number;
  total: number;
  layerIdsByChainIndex: Record<number, number>;
  groupId: number;
  placementDurationMs: number;
}

export interface GridBatchPlacementReport {
  completed: number;
  total: number;
  placedLayerIds: number[];
  failedIndex?: number;
  failedItem?: GridImageInput;
  error?: string;
  unexecuted: number;
  placementDurationMs: number;
}

export class GridTargetOccupiedError extends Error {
  constructor(public readonly slotIds: string[]) {
    super(`目标位置 ${slotIds.join("、")} 已被占用。`);
    this.name = "GridTargetOccupiedError";
  }
}

interface ModalExecutionContext {
  hostControl: HistorySuspensionHostControl;
}

const occupancyCache = new Map<number, GridOccupancySnapshot>();
const layoutListeners = new Set<(snapshot: GridOccupancySnapshot) => void>();

export function subscribeGridLayout(
  listener: (snapshot: GridOccupancySnapshot) => void
): () => void {
  layoutListeners.add(listener);
  return () => layoutListeners.delete(listener);
}

export function cachedGridOccupancy(documentId: number): GridOccupancySnapshot | undefined {
  return occupancyCache.get(documentId);
}

export function invalidateGridOccupancy(documentId: number): void {
  occupancyCache.delete(documentId);
}

export function isStandardGridCanvas(documentValue: unknown): boolean {
  return resolvePlacementMode(documentValue) === "STANDARD_GRID";
}

export function readGridMetadata(documentValue: unknown): GridMetadataStoreState {
  return readGridMetadataStore(documentValue as GridMetadataDocumentLike);
}

export async function initializeGridMetadata(documentValue: unknown): Promise<void> {
  const document = documentValue as StandardGridDocumentLike;
  await core.executeAsModal(async () => {
    const current = activeDocument();
    if (!current || current.id !== document.id) throw new Error("初始化网格前活动文档已改变。");
    await initializeGridMetadataStore(current);
  }, { commandName: "棋子go · 初始化标准网格" });
  const verified = inspectGridCanvas(document);
  if (verified.mode !== "STANDARD_GRID") {
    throw new Error(verified.message || "网格初始化后重新读取失败。");
  }
  invalidateGridOccupancy(document.id);
}

export function scanOccupancy(documentValue: unknown): GridOccupancySnapshot {
  const document = documentValue as StandardGridDocumentLike;
  if (!isStandardGridCanvas(document)) throw new Error("当前文档不是棋子go标准网格画布。");
  const snapshot = scanGridLayerSnapshots(document.id, topLevelLayerSnapshots(document));
  occupancyCache.set(document.id, snapshot);
  emitLayout(snapshot);
  console.log("chess-go.grid.layout-scan", JSON.stringify({
    documentId: document.id,
    scannedTopLevelLayerCount: snapshot.scannedTopLevelLayerCount,
    occupiedSlotCount: snapshot.occupiedSlots.size,
    layoutScanDurationMs: snapshot.layoutScanDurationMs
  }));
  return snapshot;
}

export function refreshOccupancy(documentValue: unknown): GridOccupancySnapshot {
  const document = documentValue as StandardGridDocumentLike;
  invalidateGridOccupancy(document.id);
  return scanOccupancy(document);
}

export function occupancyForPlacement(documentValue: unknown): GridOccupancySnapshot {
  const document = documentValue as StandardGridDocumentLike;
  return occupancyCache.get(document.id) ?? scanOccupancy(document);
}

export function planGridSlots(documentValue: unknown, count: number): string[] | undefined {
  const occupancy = occupancyForPlacement(documentValue);
  if (count === 1) {
    const slotId = findFirstEmptySlot(occupancy);
    return slotId ? [slotId] : undefined;
  }
  return findContiguousSlots(occupancy, count);
}

export function planEmptyGridRow(documentValue: unknown): string[] | undefined {
  const document = documentValue as StandardGridDocumentLike;
  return findFirstEmptyRow({
    occupiedSlots: occupancyForPlacement(document).occupiedSlots,
    reservedSlots: gridDraftReservedSlots(document)
  });
}

export function inspectGridDraftBinding(
  documentValue: unknown,
  chainId: string,
  items: readonly GridDraftChainItemIdentity[]
): GridDraftBindingInspection {
  const document = documentValue as StandardGridDocumentLike;
  if (!isStandardGridCanvas(document)) {
    return { status: "invalid", reason: "当前文档不是棋子go标准网格画布。" };
  }
  const expectedNames = gridDraftExpectedLayerNames(chainId, items);
  const matchingGroups = topLevelLayerValues(document).filter(
    (layer) => layer.kind === "group" && gridDraftGroupRow(layer.name, chainId) !== undefined
  );
  if (matchingGroups.length > 1) {
    return { status: "invalid", reason: "同一条链存在多个 AI初稿图层组。" };
  }
  const draftGroup = matchingGroups[0];
  const draftGroupRow = draftGroup ? gridDraftGroupRow(draftGroup.name, chainId) : undefined;
  if (draftGroupRow !== undefined && draftGroupRow >= STANDARD_GRID_TEMPLATE.grid.rows) {
    return { status: "invalid", reason: "AI初稿图层组记录的绑定行超出标准网格。" };
  }
  const markerLayers = collectDraftMarkerLayers(document, expectedNames).filter(
    (record) => !record.ancestorGroupNames.some(
      (name) => isGridDraftRefinementGroupName(name, chainId)
    )
  );
  if (draftGroup && markerLayers.some((record) => record.parentGroupId !== draftGroup.id)) {
    return { status: "invalid", reason: "同一条链的 AI初稿图层位于绑定组外。" };
  }
  if (!draftGroup && markerLayers.some((record) => record.parentGroupId !== null)) {
    return { status: "invalid", reason: "AI初稿图层已移动到无法识别的图层组。" };
  }
  const layerIdsByChainIndex: Record<number, number> = {};
  let boundRow = draftGroupRow;
  for (const { layer, chainIndex } of markerLayers) {
    if (layerIdsByChainIndex[chainIndex] !== undefined) {
      return { status: "invalid", reason: `链位置 ${chainIndex + 1} 存在多个 AI初稿图层。` };
    }
    if (layer.kind !== "smartObject") {
      return { status: "invalid", reason: `链位置 ${chainIndex + 1} 的 AI初稿图层已不是智能对象。` };
    }
    const bounds = numericBoundsNoEffects(layer);
    if (!bounds) {
      return { status: "invalid", reason: `链位置 ${chainIndex + 1} 的 AI初稿图层边界为空。` };
    }
    const slot = primaryGridSlotForBounds(bounds);
    if (!slot || slot.column !== chainIndex) {
      return { status: "invalid", reason: `链位置 ${chainIndex + 1} 的 AI初稿图层已离开固定列。` };
    }
    if (boundRow !== undefined && boundRow !== slot.row) {
      return { status: "invalid", reason: "同一条链的 AI初稿图层分散在多行。" };
    }
    boundRow = slot.row;
    layerIdsByChainIndex[chainIndex] = layer.id;
  }
  if (boundRow === undefined) return { status: "missing" };
  return {
    status: "valid",
    row: boundRow,
    rowSlotIds: Array.from(
      { length: STANDARD_GRID_TEMPLATE.grid.columns },
      (_, column) => gridSlotAt(boundRow!, column).id
    ),
    groupId: draftGroup?.id ?? null,
    layerIdsByChainIndex
  };
}

export function recheckTargetSlots(
  documentValue: unknown,
  slotIds: readonly string[],
  options: { excludedLayerIds?: readonly number[]; updateCache?: boolean } = {}
): { occupiedSlots: Set<string>; targetRecheckDurationMs: number } {
  const document = documentValue as StandardGridDocumentLike;
  const startedAt = Date.now();
  const targets = slotIds.map((slotId) => gridSlotFromId(slotId));
  const occupiedSlots = new Set<string>();
  const slotLayerIds = new Map<string, number[]>();
  const excludedLayerIds = new Set(options.excludedLayerIds ?? []);
  for (const layer of topLevelLayerSnapshots(document)) {
    if (excludedLayerIds.has(layer.id) || isGridOccupancyExcludedLayer(layer) || !layer.boundsNoEffects) continue;
    for (const target of targets) {
      if (!gridBoundsOccupiesSlot(layer.boundsNoEffects, target.bounds)) continue;
      occupiedSlots.add(target.id);
      const ids = slotLayerIds.get(target.id);
      if (ids) ids.push(layer.id);
      else slotLayerIds.set(target.id, [layer.id]);
    }
  }
  const duration = Math.max(0, Date.now() - startedAt);
  if (options.updateCache ?? true) {
    updateTargetCache(document.id, targets.map((target) => target.id), occupiedSlots, slotLayerIds);
  }
  console.log("chess-go.grid.target-recheck", JSON.stringify({
    documentId: document.id,
    targetSlotCount: slotIds.length,
    occupiedSlotCount: occupiedSlots.size,
    targetRecheckDurationMs: duration
  }));
  return { occupiedSlots, targetRecheckDurationMs: duration };
}

export async function placeImageInSlot(
  documentValue: unknown,
  image: GridImageInput,
  slotId: string,
  options: { allowUpscale?: boolean } = {}
): Promise<{ layerId: number; placementDurationMs: number }> {
  const document = documentValue as StandardGridDocumentLike;
  assertGridDocument(document);
  const temporary = await downloadTemporaryImage(image.url, {
    prefix: "chess-go-grid",
    fileName: image.fileName
  });
  const startedAt = Date.now();
  try {
    const token = storage.localFileSystem.createSessionToken(temporary);
    let layerId = 0;
    try {
      await core.executeAsModal(async () => {
        const current = requireActiveGridDocument(document.id);
        const occupied = recheckTargetSlots(current, [slotId]).occupiedSlots;
        if (occupied.size) throw new GridTargetOccupiedError(Array.from(occupied));
        const layer = await placeTemporaryImageInSlot(current, token, image, slotId, options);
        layerId = layer.id;
      }, { commandName: `棋子go · 放入 ${slotId}` });
    } catch (error) {
      if (!(error instanceof GridTargetOccupiedError)) invalidateGridOccupancy(document.id);
      throw error;
    }
    markPlacedSlots(document.id, [slotId], [layerId]);
    const placementDurationMs = Math.max(0, Date.now() - startedAt);
    console.log("chess-go.grid.placement", JSON.stringify({
      documentId: document.id,
      slotId,
      layerId,
      placementDurationMs
    }));
    return { layerId, placementDurationMs };
  } finally {
    await deleteTemporaryFile(temporary);
  }
}

export async function placeImageBatch(
  documentValue: unknown,
  images: readonly GridImageInput[],
  slotIds: readonly string[],
  options: { allowUpscale?: boolean; requiredEmptySlotIds?: readonly string[] } = {}
): Promise<GridBatchPlacementReport> {
  const document = documentValue as StandardGridDocumentLike;
  assertGridDocument(document);
  if (!images.length || images.length !== slotIds.length) {
    throw new Error("批量图片和目标格数量必须一致且不能为空。");
  }
  const requiredEmptySlotIds = options.requiredEmptySlotIds?.length
    ? [...options.requiredEmptySlotIds]
    : [...slotIds];
  if (new Set(requiredEmptySlotIds).size !== requiredEmptySlotIds.length) {
    throw new Error("批量空位复检范围存在重复格子。");
  }
  const requiredEmptySlotSet = new Set(requiredEmptySlotIds);
  if (!slotIds.every((slotId) => requiredEmptySlotSet.has(slotId))) {
    throw new Error("批量目标格不在要求保持为空的范围内。");
  }
  const temporaryFiles: storage.File[] = [];
  try {
    for (const image of images) {
      temporaryFiles.push(await downloadTemporaryImage(image.url, {
        prefix: "chess-go-grid-batch",
        fileName: image.fileName
      }));
    }
    const startedAt = Date.now();
    const placedLayerIds: number[] = [];
    let failure: { index: number; error: string } | undefined;
    try {
      await core.executeAsModal(async () => {
        const current = requireActiveGridDocument(document.id);
        const occupied = recheckTargetSlots(current, requiredEmptySlotIds).occupiedSlots;
        if (occupied.size) throw new GridTargetOccupiedError(Array.from(occupied));
        const reserved = new Set(slotIds);
        if (reserved.size !== slotIds.length) throw new Error("批量目标格存在重复，已停止插入。");
        for (let index = 0; index < images.length; index += 1) {
          const image = images[index]!;
          const slotId = slotIds[index]!;
          const token = storage.localFileSystem.createSessionToken(temporaryFiles[index]!);
          try {
            const layer = await placeTemporaryImageInSlot(current, token, image, slotId, options);
            placedLayerIds.push(layer.id);
          } catch (error) {
            failure = {
              index,
              error: error instanceof Error ? error.message : String(error)
            };
            break;
          }
        }
      }, { commandName: `棋子go · 批量放入 ${images.length} 个棋子` });
    } catch (error) {
      if (!(error instanceof GridTargetOccupiedError)) invalidateGridOccupancy(document.id);
      throw error;
    }

    const completedSlots = slotIds.slice(0, placedLayerIds.length);
    markPlacedSlots(document.id, completedSlots, placedLayerIds);
    const placementDurationMs = Math.max(0, Date.now() - startedAt);
    const failedIndex = failure?.index;
    const report: GridBatchPlacementReport = {
      completed: placedLayerIds.length,
      total: images.length,
      placedLayerIds,
      ...(failure ? {
        failedIndex,
        failedItem: images[failedIndex!],
        error: failure.error
      } : {}),
      unexecuted: failure ? Math.max(0, images.length - failure.index - 1) : 0,
      placementDurationMs
    };
    console.log("chess-go.grid.batch-placement", JSON.stringify({
      documentId: document.id,
      completed: report.completed,
      total: report.total,
      failedIndex: report.failedIndex ?? null,
      unexecuted: report.unexecuted,
      placementDurationMs
    }));
    return report;
  } finally {
    await Promise.all(temporaryFiles.map(deleteTemporaryFile));
  }
}

export async function upsertGridDraftImages(
  documentValue: unknown,
  chainId: string,
  chainLabel: string,
  chainItems: readonly GridDraftChainItemIdentity[],
  images: readonly GridDraftUpsertImage[],
  rowSlotIds: readonly string[]
): Promise<GridDraftUpsertReport> {
  const document = documentValue as StandardGridDocumentLike;
  assertGridDocument(document);
  if (!chainId.trim() || !chainItems.length || !images.length) {
    throw new Error("AI初稿链、链位置和待写入图片均不能为空。");
  }
  if (chainItems.length > STANDARD_GRID_TEMPLATE.grid.columns) {
    throw new Error("AI初稿物品链超过标准网格单行容量。");
  }
  if (chainItems.some((item, index) => item.chainIndex !== index || !item.assetCode.trim())) {
    throw new Error("AI初稿物品链位置必须从 1 开始连续且包含棋子编号。");
  }
  assertCompleteGridRow(rowSlotIds);
  const chainItemByIndex = new Map(chainItems.map((item) => [item.chainIndex, item]));
  if (new Set(images.map((image) => image.chainIndex)).size !== images.length) {
    throw new Error("AI初稿待写入图片包含重复链位置。");
  }
  for (const image of images) {
    const item = chainItemByIndex.get(image.chainIndex);
    if (!item || item.assetCode !== image.assetCode || image.chainIndex >= chainItems.length) {
      throw new Error("AI初稿图片与物品链固定位置不一致。");
    }
  }
  const initialInspection = inspectGridDraftBinding(document, chainId, chainItems);
  assertUsableDraftBinding(initialInspection, rowSlotIds);

  const temporaryFiles: storage.File[] = [];
  try {
    for (const image of images) {
      temporaryFiles.push(await downloadTemporaryImage(image.url, {
        prefix: "chess-go-grid-draft",
        fileName: image.fileName
      }));
    }
    const startedAt = Date.now();
    const layerIdsByChainIndex: Record<number, number> = {};
    let draftGroupId: number | undefined;
    await core.executeAsModal(async (executionContext) => {
      const current = requireActiveGridDocument(document.id);
      const inspection = inspectGridDraftBinding(current, chainId, chainItems);
      assertUsableDraftBinding(inspection, rowSlotIds);
      if (inspection.status === "invalid") {
        throw new Error(inspection.reason);
      }
      if (inspection.status === "missing") {
        const occupied = recheckTargetSlots(current, rowSlotIds).occupiedSlots;
        const reserved = gridDraftReservedSlots(current);
        for (const slotId of rowSlotIds) {
          if (reserved.has(slotId)) occupied.add(slotId);
        }
        if (occupied.size) throw new GridTargetOccupiedError(Array.from(occupied));
      } else {
        for (const image of images) {
          const existingLayerId = inspection.layerIdsByChainIndex[image.chainIndex];
          const targetSlotId = rowSlotIds[image.chainIndex]!;
          if (gridDraftTargetIsOccupied(current, targetSlotId, inspection, existingLayerId)) {
            throw new GridTargetOccupiedError([targetSlotId]);
          }
        }
      }

      const context = executionContext as unknown as ModalExecutionContext;
      await runWithRollbackHistory(
        context.hostControl,
        { documentID: document.id, name: `AI初稿 · 更新 ${images.length} 个棋子` },
        async () => {
          const row = gridSlotFromId(rowSlotIds[0]!).row;
          let draftGroup = inspection.status === "valid" && inspection.groupId !== null
            ? topLevelLayerById(current, inspection.groupId)
            : undefined;
          if (draftGroup && draftGroup.kind !== "group") {
            throw new Error("AI初稿绑定图层组已改变类型。");
          }
          if (!draftGroup) {
            draftGroup = await current.createLayerGroup({
              name: gridDraftGroupName(chainId, chainLabel, row)
            }) ?? undefined;
            if (!draftGroup) throw new Error("Photoshop 未能创建 AI初稿图层组。");
            if (inspection.status === "valid") {
              for (const legacyLayerId of Object.values(inspection.layerIdsByChainIndex)) {
                const legacyLayer = findGridLayerById(current, legacyLayerId);
                if (!legacyLayer) throw new Error("迁移旧版 AI初稿图层时无法重新定位智能对象。");
                await legacyLayer.move(draftGroup, constants.ElementPlacement.PLACEINSIDE);
              }
            }
          }
          draftGroup.name = gridDraftGroupName(chainId, chainLabel, row);
          // Photoshop can inherit the active layer/group visibility when a new
          // group is created. AI drafts must be visible immediately after an
          // insert or replacement on a standard-grid canvas.
          draftGroup.visible = true;
          draftGroupId = draftGroup.id;

          for (let index = 0; index < images.length; index += 1) {
            const image = images[index]!;
            const targetSlotId = rowSlotIds[image.chainIndex]!;
            const markerName = gridDraftLayerName(chainId, image.chainIndex, image.assetCode);
            const existingLayerId = inspection.status === "valid"
              ? inspection.layerIdsByChainIndex[image.chainIndex]
              : undefined;
            let targetLayer: GridLayerLike;
            if (existingLayerId === undefined) {
              const token = storage.localFileSystem.createSessionToken(temporaryFiles[index]!);
              targetLayer = await placeTemporaryImageInSlot(
                current,
                token,
                { ...image, layerName: markerName },
                targetSlotId,
                { allowUpscale: false }
              );
              await targetLayer.move(draftGroup, constants.ElementPlacement.PLACEINSIDE);
              targetLayer = findGridLayerById(current, targetLayer.id) ?? targetLayer;
            } else {
              const existingLayer = findGridLayerById(current, existingLayerId);
              if (!existingLayer || existingLayer.kind !== "smartObject") {
                throw new Error(`AI初稿链位置 ${image.chainIndex + 1} 的智能对象已不存在。`);
              }
              const token = storage.localFileSystem.createSessionToken(temporaryFiles[index]!);
              const selectResults = await action.batchPlay([selectLayerDescriptor(existingLayerId)], {});
              assertSingleBatchPlaySucceeded(selectResults, "选择 AI初稿智能对象");
              const replaceResults = await action.batchPlay([replacePlacedLayerContentsDescriptor(token)], {});
              assertSingleBatchPlaySucceeded(replaceResults, "替换 AI初稿智能对象内容");
              const replacedLayer = findGridLayerById(current, existingLayerId);
              if (!replacedLayer) throw new Error("替换 AI初稿后无法重新定位智能对象。");
              replacedLayer.name = markerName;
              await fitLayerInsideBounds(
                replacedLayer as unknown as TransformableLayerLike,
                gridSlotFromId(targetSlotId).bounds,
                { allowUpscale: false }
              );
              targetLayer = replacedLayer;
            }
            targetLayer.visible = true;
            layerIdsByChainIndex[image.chainIndex] = targetLayer.id;
          }
          draftGroup.visible = true;
        }
      );
    }, { commandName: `AI初稿 · 写入 ${images.length} 个棋子` });

    const targetSlotIds = images.map((image) => rowSlotIds[image.chainIndex]!);
    const placedLayerIds = images.map((image) => layerIdsByChainIndex[image.chainIndex]!);
    if (draftGroupId === undefined) throw new Error("AI初稿写入后没有返回图层组。");
    markPlacedSlots(document.id, targetSlotIds, placedLayerIds);
    return {
      completed: images.length,
      total: images.length,
      layerIdsByChainIndex,
      groupId: draftGroupId,
      placementDurationMs: Math.max(0, Date.now() - startedAt)
    };
  } finally {
    await Promise.all(temporaryFiles.map(deleteTemporaryFile));
  }
}

export { alignResultToSource };

async function placeTemporaryImageInSlot(
  document: StandardGridDocumentLike,
  token: string,
  image: GridImageInput,
  slotId: string,
  options: { allowUpscale?: boolean }
): Promise<GridLayerLike> {
  let placedLayer: GridLayerLike | undefined;
  try {
    const results = await action.batchPlay([placeEmbeddedDescriptor(token)], {});
    assertSingleBatchPlaySucceeded(results, `置入 ${slotId}`);
    placedLayer = document.activeLayers?.[0];
    if (!placedLayer || !Number.isInteger(placedLayer.id)) {
      throw new Error(`Photoshop 置入 ${slotId} 后没有返回图层。`);
    }
    placedLayer.name = image.layerName?.trim() || `AI 候选 ${slotId}`;
    await fitLayerInsideBounds(placedLayer as unknown as TransformableLayerLike, gridSlotFromId(slotId).bounds, {
      allowUpscale: options.allowUpscale ?? false
    });
    return placedLayer;
  } catch (error) {
    if (placedLayer?.delete) {
      try { await placedLayer.delete(); } catch { /* Preserve the placement failure. */ }
    }
    throw error;
  }
}

function assertGridDocument(document: StandardGridDocumentLike): void {
  if (!Number.isInteger(document.id) || resolvePlacementMode(document) !== "STANDARD_GRID") {
    throw new Error("当前不是棋子go标准网格画布，AI 结果已保留。");
  }
}

function requireActiveGridDocument(expectedDocumentId: number): StandardGridDocumentLike {
  const current = activeDocument();
  if (!current || current.id !== expectedDocumentId) {
    throw new Error("写入 Photoshop 前活动文档已改变，AI 结果已保留。");
  }
  assertGridDocument(current);
  return current;
}

function activeDocument(): StandardGridDocumentLike | null {
  try {
    return app.documents?.length
      ? app.activeDocument as unknown as StandardGridDocumentLike
      : null;
  } catch {
    return null;
  }
}

function assertCompleteGridRow(rowSlotIds: readonly string[]): void {
  if (rowSlotIds.length !== STANDARD_GRID_TEMPLATE.grid.columns) {
    throw new Error("AI初稿目标必须是一条完整的标准网格行。");
  }
  const slots = rowSlotIds.map((slotId) => gridSlotFromId(slotId));
  const row = slots[0]?.row;
  if (row === undefined || slots.some((slot, column) => slot.row !== row || slot.column !== column)) {
    throw new Error("AI初稿目标格不是按 C01–C12 排列的同一行。");
  }
}

function assertUsableDraftBinding(
  inspection: GridDraftBindingInspection,
  expectedRowSlotIds: readonly string[]
): void {
  if (inspection.status === "invalid") throw new Error(inspection.reason);
  if (
    inspection.status === "valid"
    && (
      inspection.rowSlotIds.length !== expectedRowSlotIds.length
      || inspection.rowSlotIds.some((slotId, index) => slotId !== expectedRowSlotIds[index])
    )
  ) {
    throw new Error("该物品链已绑定到另一条标准网格行，不会创建第二排。");
  }
}

function topLevelLayerById(
  document: StandardGridDocumentLike,
  layerId: number
): GridLayerLike | undefined {
  const layers = document.layers as unknown as GridLayerCollectionLike;
  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index];
    if (layer?.id === layerId) return layer;
  }
  return undefined;
}

function findGridLayerById(
  document: StandardGridDocumentLike,
  layerId: number
): GridLayerLike | undefined {
  const layer = findLayerById(
    document.layers as unknown as Parameters<typeof findLayerById>[0],
    layerId
  );
  return layer ? layer as unknown as GridLayerLike : undefined;
}

function topLevelLayerValues(document: StandardGridDocumentLike): GridLayerLike[] {
  return layerCollectionValues(document.layers as unknown as GridLayerCollectionLike);
}

function layerCollectionValues(collection: GridLayerCollectionLike | undefined): GridLayerLike[] {
  const values: GridLayerLike[] = [];
  if (!collection) return values;
  for (let index = 0; index < collection.length; index += 1) {
    const layer = collection[index];
    if (layer) values.push(layer);
  }
  return values;
}

function collectDraftMarkerLayers(
  document: StandardGridDocumentLike,
  expectedNames: ReadonlyMap<string, number>
): Array<{
  layer: GridLayerLike;
  chainIndex: number;
  parentGroupId: number | null;
  ancestorGroupNames: string[];
}> {
  const records: Array<{
    layer: GridLayerLike;
    chainIndex: number;
    parentGroupId: number | null;
    ancestorGroupNames: string[];
  }> = [];
  const visit = (
    collection: GridLayerCollectionLike | undefined,
    parentGroupId: number | null,
    ancestorGroupNames: string[]
  ): void => {
    for (const layer of layerCollectionValues(collection)) {
      const chainIndex = expectedNames.get(layer.name);
      if (chainIndex !== undefined) {
        records.push({ layer, chainIndex, parentGroupId, ancestorGroupNames });
      }
      if (layer.layers) visit(layer.layers, layer.id, [...ancestorGroupNames, layer.name]);
    }
  };
  visit(document.layers as unknown as GridLayerCollectionLike, null, []);
  return records;
}

function numericBoundsNoEffects(layer: GridLayerLike): GridRect | undefined {
  try {
    const source = layer.boundsNoEffects;
    if (!source) return undefined;
    const bounds = {
      left: Number(source.left),
      top: Number(source.top),
      right: Number(source.right),
      bottom: Number(source.bottom)
    };
    return Object.values(bounds).every(Number.isFinite)
      && bounds.right > bounds.left
      && bounds.bottom > bounds.top
      ? bounds
      : undefined;
  } catch {
    return undefined;
  }
}

function gridDraftReservedSlots(document: StandardGridDocumentLike): Set<string> {
  const reserved = new Set<string>();
  for (const layer of topLevelLayerValues(document)) {
    if (layer.kind !== "group") continue;
    const row = gridDraftGroupRow(layer.name);
    if (row === undefined || row >= STANDARD_GRID_TEMPLATE.grid.rows) continue;
    for (let column = 0; column < STANDARD_GRID_TEMPLATE.grid.columns; column += 1) {
      reserved.add(gridSlotAt(row, column).id);
    }
  }
  return reserved;
}

function gridDraftTargetIsOccupied(
  document: StandardGridDocumentLike,
  targetSlotId: string,
  inspection: GridDraftBindingValid,
  existingLayerId: number | undefined
): boolean {
  const excludedLayerIds = inspection.groupId === null
    ? existingLayerId === undefined ? [] : [existingLayerId]
    : [inspection.groupId];
  if (recheckTargetSlots(document, [targetSlotId], {
    excludedLayerIds,
    updateCache: false
  }).occupiedSlots.size) {
    return true;
  }
  if (inspection.groupId === null) return false;
  const group = topLevelLayerById(document, inspection.groupId);
  if (!group || group.kind !== "group") return true;
  const target = gridSlotFromId(targetSlotId);
  return layerCollectionValues(group.layers).some((layer) => {
    if (layer.id === existingLayerId) return false;
    const bounds = numericBoundsNoEffects(layer);
    return bounds ? gridBoundsOccupiesSlot(bounds, target.bounds) : false;
  });
}

function topLevelLayerSnapshots(document: StandardGridDocumentLike): GridLayerSnapshot[] {
  const snapshots: GridLayerSnapshot[] = [];
  const layers = document.layers as unknown as GridLayerCollectionLike;
  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index];
    if (!layer) continue;
    let boundsNoEffects: GridRect | undefined;
    try {
      const bounds = layer.boundsNoEffects;
      if (bounds) {
        const numeric = {
          left: Number(bounds.left),
          top: Number(bounds.top),
          right: Number(bounds.right),
          bottom: Number(bounds.bottom)
        };
        if (Object.values(numeric).every(Number.isFinite) && numeric.right > numeric.left && numeric.bottom > numeric.top) {
          boundsNoEffects = numeric;
        }
      }
    } catch {
      // Empty and host-only helper layers do not participate in occupancy.
    }
    snapshots.push({
      id: layer.id,
      name: layer.name,
      kind: layer.kind,
      visible: layer.visible,
      ...(boundsNoEffects ? { boundsNoEffects } : {})
    });
  }
  return snapshots;
}

function updateTargetCache(
  documentId: number,
  targetSlotIds: readonly string[],
  occupiedSlots: ReadonlySet<string>,
  slotLayerIds: ReadonlyMap<string, number[]>
): void {
  const previous = occupancyCache.get(documentId);
  if (!previous) return;
  const next: GridOccupancySnapshot = {
    ...previous,
    occupiedSlots: new Set(previous.occupiedSlots),
    slotLayerIds: new Map(previous.slotLayerIds)
  };
  for (const slotId of targetSlotIds) {
    if (occupiedSlots.has(slotId)) {
      next.occupiedSlots.add(slotId);
      next.slotLayerIds.set(slotId, [...(slotLayerIds.get(slotId) ?? [])]);
    } else {
      next.occupiedSlots.delete(slotId);
      next.slotLayerIds.delete(slotId);
    }
  }
  occupancyCache.set(documentId, next);
  emitLayout(next);
}

function markPlacedSlots(
  documentId: number,
  slotIds: readonly string[],
  layerIds: readonly number[]
): void {
  const previous = occupancyCache.get(documentId);
  if (!previous) return;
  const next: GridOccupancySnapshot = {
    ...previous,
    occupiedSlots: new Set(previous.occupiedSlots),
    slotLayerIds: new Map(previous.slotLayerIds)
  };
  slotIds.forEach((slotId, index) => {
    next.occupiedSlots.add(slotId);
    next.slotLayerIds.set(slotId, [layerIds[index]!]);
  });
  occupancyCache.set(documentId, next);
  emitLayout(next);
}

function emitLayout(snapshot: GridOccupancySnapshot): void {
  for (const listener of layoutListeners) listener(snapshot);
}
