import { action, app, constants, core } from "photoshop";
import { storage } from "uxp";
import {
  artboardBoundsFromDescriptor,
  calculateAiCandidatePlacement,
  chooseAiCandidateReplacementMeasurement,
  rebaseTargetBoundsAfterArtboardShift
} from "../domain/aiCandidatePlacement";
import { DEFAULT_EDITABLE_CANVAS_SIZE } from "../domain/generationSettings";
import { deleteTemporaryFile } from "../infrastructure/filesystem/uxpFiles";
import {
  getArtboardDescriptor,
  placeEmbeddedDescriptor,
  replacePlacedLayerContentsDescriptor,
  selectLayerDescriptor
} from "./actionDescriptors";
import {
  findEditableCanvasTargetByIds,
  findEditableCanvasTargets,
  isEditableCanvasLayerName,
  preferredEditableCanvasLayerName,
  type CandidateTargetLayer,
  type CandidateTargetDocument,
  type EditableCanvasTarget
} from "./aiCandidateTarget";
import {
  assertExpectedDocumentId,
  assertSingleBatchPlaySucceeded,
  runWithRollbackHistory,
  type HistorySuspensionHostControl
} from "./aiCandidateBackfillSafety";
import {
  smartObjectGeometryFromDescriptor,
  type SmartObjectTransformBounds,
  type SmartObjectTransformGeometry
} from "./smartObjectBounds";

export interface CandidateBackfillResult {
  applied: boolean;
  detail: string;
}

export interface CandidateBackfillTarget {
  documentId: number;
  artboardId: number;
  referenceLayerId?: number;
  referenceIssue?: "missing";
  targetLayerId?: number;
  targetIssue?: "missing";
}

export async function backfillAiCandidate(
  assetCode: string,
  imageUrl: string,
  expected: CandidateBackfillTarget,
  onAudit?: (message: string) => void,
  onReplacementMayHaveMutated?: () => void
): Promise<CandidateBackfillResult> {
  const document = activeDocument();
  if (!document) {
    return { applied: false, detail: "候选已选中；当前没有打开的棋子归档 PSD，未回填画板。" };
  }
  assertExpectedDocumentId(expected.documentId, document.id, "下载候选图前，");
  const initialScope = stableExpectedBackfillScope(document, assetCode, expected);
  if (!initialScope) {
    return { applied: false, detail: `候选已选中；画板 ${assetCode} 的参考图或空白智能对象状态已经变化。` };
  }
  if (initialScope.mode === "existing") {
    onAudit?.(formatAudit("target.initial", document, initialScope.target));
  } else {
    onAudit?.(formatMissingTargetAudit("target.initial-missing", document, initialScope.artboard));
  }
  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`下载 AI 候选图失败：HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const extension = extensionFromContentType(response.headers.get("content-type"));
  const folder = await storage.localFileSystem.getTemporaryFolder();
  const temporary = await folder.createFile(
    `chess-go-ai-${safeFileName(assetCode)}-${Date.now()}.${extension}`,
    { overwrite: true }
  );
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  await temporary.write(copy, { format: storage.formats.binary });

  try {
    const token = storage.localFileSystem.createSessionToken(temporary);
    let createdTarget = false;
    await core.executeAsModal(
      async (executionContext) => {
        const context = executionContext as unknown as ModalExecutionContext;
        const currentDocument = activeDocument();
        if (!currentDocument) throw new Error("回填过程中当前 PSD 已关闭。");
        assertExpectedDocumentId(expected.documentId, currentDocument.id, "进入 Photoshop 写入阶段时，");
        const currentScope = stableExpectedBackfillScope(currentDocument, assetCode, expected);
        if (!currentScope) {
          throw new Error(`回填已停止：下载候选图期间画板 ${assetCode} 的参考图或目标智能对象发生了变化。`);
        }
        await runWithRollbackHistory(
          context.hostControl,
          {
            documentID: expected.documentId,
            name: `回填 AI 候选：${assetCode}`
          },
          async () => {
            if (currentScope.mode === "existing") {
              await replaceExistingTarget(
                currentDocument,
                currentScope.target,
                token,
                onAudit,
                onReplacementMayHaveMutated
              );
            } else {
              await createAndFillMissingTarget(
                currentDocument,
                currentScope.artboard,
                token,
                onAudit,
                onReplacementMayHaveMutated
              );
              createdTarget = true;
            }
            assertExpectedDocumentId(
              expected.documentId,
              activeDocument()?.id,
              "提交 Photoshop 历史状态前，"
            );
          }
        );
      },
      { commandName: `回填 AI 候选：${assetCode}` }
    );
    return {
      applied: true,
      detail: createdTarget
        ? `已在画板 ${assetCode} 中创建智能对象并回填；图片已限制在画板范围内。`
        : `已选中并回填画板 ${assetCode}；图片已限制在画板范围内。`
    };
  } finally {
    await deleteTemporaryFile(temporary);
  }
}

async function replaceExistingTarget(
  document: CandidateTargetDocument,
  currentTarget: EditableCanvasTarget,
  token: string,
  onAudit?: (message: string) => void,
  onReplacementMayHaveMutated?: () => void
): Promise<void> {
  const targetIds = {
    artboardId: currentTarget.artboard.id,
    layerId: currentTarget.layer.id
  };
  const before = await captureGeometry(document, currentTarget, "before-replace");
  onAudit?.(formatGeometryAudit(before));
  const targetMeasurement = chooseTargetMeasurement(before);
  auditTargetMeasurement(targetMeasurement, onAudit);
  const selectResults = await action.batchPlay(
    [selectLayerDescriptor(currentTarget.layer.id)],
    {}
  );
  assertSingleBatchPlaySucceeded(selectResults, "选择回填智能对象");
  const replaceResults = await action.batchPlay(
    [replacePlacedLayerContentsDescriptor(token)],
    {}
  );
  assertSingleBatchPlaySucceeded(replaceResults, "替换智能对象内容");
  onReplacementMayHaveMutated?.();
  const replacedTarget = targetByIds(document, targetIds);
  const afterReplace = await captureGeometry(document, replacedTarget, "after-replace");
  onAudit?.(formatGeometryAudit(afterReplace));
  await fitReplacementInsideTarget(
    document,
    targetIds,
    rebaseTargetMeasurement(
      targetMeasurement,
      before.artboardDescriptorBounds,
      afterReplace.artboardDescriptorBounds,
      onAudit
    ),
    onAudit
  );
  const finalTarget = targetByIds(document, targetIds);
  onAudit?.(formatGeometryAudit(await captureGeometry(document, finalTarget, "after-placement")));
}

async function createAndFillMissingTarget(
  document: CandidateTargetDocument,
  artboard: CandidateTargetLayer,
  token: string,
  onAudit?: (message: string) => void,
  onReplacementMayHaveMutated?: () => void
): Promise<void> {
  const artboardBoundsBefore = await readArtboardBounds(artboard.id);
  const placeResults = await action.batchPlay([placeEmbeddedDescriptor(token)], {});
  assertSingleBatchPlaySucceeded(placeResults, "创建回填智能对象");
  onReplacementMayHaveMutated?.();
  const placedLayer = document.activeLayers?.[0];
  if (!placedLayer || !Number.isInteger(placedLayer.id) || !placedLayer.move) {
    throw new Error("候选图已置入，但 Photoshop 没有返回可移动的智能对象图层。");
  }
  placedLayer.name = preferredEditableCanvasLayerName(document, DEFAULT_EDITABLE_CANVAS_SIZE);
  await placedLayer.move(artboard, constants.ElementPlacement.PLACEINSIDE);
  const targetIds = { artboardId: artboard.id, layerId: placedLayer.id };
  const createdTarget = strictTargetByIds(document, targetIds);
  const afterPlace = await captureGeometry(document, createdTarget, "after-create");
  onAudit?.(formatGeometryAudit(afterPlace));
  const targetMeasurement = chooseCreatedTargetMeasurement(afterPlace);
  auditCreatedTargetCoordinateChange(
    artboardBoundsBefore,
    afterPlace.artboardDescriptorBounds,
    targetMeasurement,
    onAudit
  );
  auditTargetMeasurement(targetMeasurement, onAudit);
  await fitReplacementInsideTarget(
    document,
    targetIds,
    targetMeasurement,
    onAudit
  );
  const finalTarget = strictTargetByIds(document, targetIds);
  onAudit?.(formatGeometryAudit(await captureGeometry(document, finalTarget, "after-placement")));
}

function auditTargetMeasurement(
  targetMeasurement: TargetMeasurement,
  onAudit?: (message: string) => void
): void {
  onAudit?.(JSON.stringify({
    stage: "target.measurement",
    source: targetMeasurement.source,
    basis: targetMeasurement.basis,
    bounds: compactRect(targetMeasurement.bounds)
  }));
}

async function readArtboardBounds(layerId: number): Promise<SmartObjectTransformBounds> {
  const [descriptor] = await action.batchPlay([getArtboardDescriptor(layerId)], {});
  return artboardBoundsFromDescriptor(descriptor);
}

type GeometrySource = "dom" | "transform";

interface TargetMeasurement {
  source: GeometrySource;
  basis: "artboard-dom" | "artboard-descriptor";
  bounds: SmartObjectTransformBounds;
  artboardOffset?: { x: number; y: number };
}

interface TargetIds {
  artboardId: number;
  layerId: number;
}

interface ModalExecutionContext {
  hostControl: HistorySuspensionHostControl;
}

interface GeometrySnapshot {
  stage: string;
  documentId?: number;
  artboardId: number;
  artboardName: string;
  layerId: number;
  layerName: string;
  layerPath: Array<{ id: number; name: string }>;
  artboardDescriptorBounds: SmartObjectTransformBounds;
  artboardDomBounds?: SmartObjectTransformBounds;
  layerDomBounds?: SmartObjectTransformBounds;
  smartObject?: SmartObjectTransformGeometry;
  smartObjectError?: string;
}

async function fitReplacementInsideTarget(
  document: CandidateTargetDocument,
  targetIds: TargetIds,
  target: TargetMeasurement,
  onAudit?: (message: string) => void
): Promise<void> {
  let currentTarget = targetByIds(document, targetIds);
  let layer = currentTarget.layer;
  if (!layer.scale || !layer.translate) throw new Error("当前 Photoshop 图层不支持回填后的缩放定位。");
  const sourceBounds = await readMeasuredBounds(layer, target.source, onAudit, "source");
  const placement = calculateAiCandidatePlacement(sourceBounds, target.bounds);
  onAudit?.(JSON.stringify({
    stage: "placement.plan",
    source: target.source,
    basis: target.basis,
    sourceBounds: compactRect(sourceBounds),
    targetBounds: compactRect(target.bounds),
    scale: rounded(placement.scale),
    targetCenter: [rounded(placement.targetCenterX), rounded(placement.targetCenterY)],
    artboardOffset: target.artboardOffset
      ? [rounded(target.artboardOffset.x), rounded(target.artboardOffset.y)]
      : [0, 0]
  }));
  if (Math.abs(placement.scale - 1) > 0.0001) {
    await layer.scale(
      placement.scale * 100,
      placement.scale * 100,
      constants.AnchorPosition.MIDDLECENTER
    );
  }
  currentTarget = targetByIds(document, targetIds);
  layer = currentTarget.layer;
  if (!layer.translate) throw new Error("当前 Photoshop 图层不支持回填后的定位。");
  const fitted = await readMeasuredBounds(layer, target.source, onAudit, "after-scale");
  const centerX = (fitted.left + fitted.right) / 2;
  const centerY = (fitted.top + fitted.bottom) / 2;
  const translateX = placement.targetCenterX - centerX;
  const translateY = placement.targetCenterY - centerY;
  if (Math.abs(translateX) > 0.01 || Math.abs(translateY) > 0.01) {
    await layer.translate(translateX, translateY);
  }

  currentTarget = targetByIds(document, targetIds);
  layer = currentTarget.layer;
  let finalBounds = await readMeasuredBounds(layer, target.source, onAudit, "after-translate");
  let errorX = placement.targetCenterX - (finalBounds.left + finalBounds.right) / 2;
  let errorY = placement.targetCenterY - (finalBounds.top + finalBounds.bottom) / 2;
  if ((Math.abs(errorX) > 0.5 || Math.abs(errorY) > 0.5) && layer.translate) {
    onAudit?.(JSON.stringify({ stage: "placement.corrective-translate", dx: rounded(errorX), dy: rounded(errorY) }));
    await layer.translate(errorX, errorY);
    currentTarget = targetByIds(document, targetIds);
    finalBounds = await readMeasuredBounds(currentTarget.layer, target.source, onAudit, "after-correction");
    errorX = placement.targetCenterX - (finalBounds.left + finalBounds.right) / 2;
    errorY = placement.targetCenterY - (finalBounds.top + finalBounds.bottom) / 2;
  }

  const overflow = rectOverflow(finalBounds, target.bounds);
  onAudit?.(JSON.stringify({
    stage: "placement.final",
    bounds: compactRect(finalBounds),
    centerError: [rounded(errorX), rounded(errorY)],
    overflow: compactOverflow(overflow)
  }));
  if (Math.abs(errorX) > 1 || Math.abs(errorY) > 1 || Object.values(overflow).some((value) => value > 1)) {
    throw new Error("候选已替换，但 Photoshop 返回的最终几何仍偏离原空白智能对象；请导出诊断包。");
  }
}

async function readSmartObjectGeometry(layerId: number): Promise<SmartObjectTransformGeometry> {
  const [descriptor] = await action.batchPlay(
    [{
      _obj: "get",
      _target: [
        { _property: "smartObjectMore" },
        { _ref: "layer", _id: layerId }
      ],
      _options: { dialogOptions: "dontDisplay" }
    }],
    {}
  );
  return smartObjectGeometryFromDescriptor(descriptor);
}

async function captureGeometry(
  document: CandidateTargetDocument,
  target: EditableCanvasTarget,
  stage: string
): Promise<GeometrySnapshot> {
  const artboardDomBounds = readDomBounds(target.artboard);
  const layerDomBounds = readDomBounds(target.layer);
  const snapshot: GeometrySnapshot = {
    stage,
    ...(document.id === undefined ? {} : { documentId: document.id }),
    artboardId: target.artboard.id,
    artboardName: target.artboard.name,
    layerId: target.layer.id,
    layerName: target.layer.name,
    layerPath: target.path.map((layer) => ({ id: layer.id, name: layer.name })),
    artboardDescriptorBounds: await readArtboardBounds(target.artboard.id),
    ...(artboardDomBounds ? { artboardDomBounds } : {}),
    ...(layerDomBounds ? { layerDomBounds } : {})
  };
  try {
    snapshot.smartObject = await readSmartObjectGeometry(target.layer.id);
  } catch (error) {
    snapshot.smartObjectError = error instanceof Error ? error.message : String(error);
  }
  return snapshot;
}

function chooseTargetMeasurement(snapshot: GeometrySnapshot): TargetMeasurement {
  // boundsNoEffects can shrink to the visible pixels of the current candidate.
  // It is valid as the measurement source, but never as the next replacement's target.
  const measurement = chooseAiCandidateReplacementMeasurement({
    artboardDescriptorBounds: snapshot.artboardDescriptorBounds,
    ...(snapshot.layerDomBounds ? { layerDomBounds: snapshot.layerDomBounds } : {}),
    ...(snapshot.smartObject ? { smartObjectTransformBounds: snapshot.smartObject.bounds } : {})
  });
  return {
    ...measurement,
    basis: "artboard-descriptor"
  };
}

function chooseCreatedTargetMeasurement(snapshot: GeometrySnapshot): TargetMeasurement {
  if (snapshot.artboardDomBounds && snapshot.layerDomBounds) {
    return { source: "dom", basis: "artboard-dom", bounds: snapshot.artboardDomBounds };
  }
  if (snapshot.smartObject) {
    return {
      source: "transform",
      basis: "artboard-descriptor",
      bounds: snapshot.artboardDescriptorBounds
    };
  }
  throw new Error("Photoshop 没有返回可用于定位新建智能对象的同坐标系边界，已撤销本次回填。");
}

function auditCreatedTargetCoordinateChange(
  beforeArtboardBounds: SmartObjectTransformBounds,
  afterArtboardBounds: SmartObjectTransformBounds,
  target: TargetMeasurement,
  onAudit?: (message: string) => void
): void {
  onAudit?.(JSON.stringify({
    stage: "target.rebased",
    artboardBefore: compactRect(beforeArtboardBounds),
    artboardAfter: compactRect(afterArtboardBounds),
    offset: [
      rounded(afterArtboardBounds.left - beforeArtboardBounds.left),
      rounded(afterArtboardBounds.top - beforeArtboardBounds.top)
    ],
    bounds: compactRect(target.bounds),
    basis: target.basis
  }));
}

function rebaseTargetMeasurement(
  target: TargetMeasurement,
  beforeArtboardBounds: SmartObjectTransformBounds,
  afterArtboardBounds: SmartObjectTransformBounds,
  onAudit?: (message: string) => void
): TargetMeasurement {
  const x = afterArtboardBounds.left - beforeArtboardBounds.left;
  const y = afterArtboardBounds.top - beforeArtboardBounds.top;
  const bounds = rebaseTargetBoundsAfterArtboardShift(
    target.bounds,
    beforeArtboardBounds,
    afterArtboardBounds
  );
  onAudit?.(JSON.stringify({
    stage: "target.rebased",
    artboardBefore: compactRect(beforeArtboardBounds),
    artboardAfter: compactRect(afterArtboardBounds),
    offset: [rounded(x), rounded(y)],
    bounds: compactRect(bounds)
  }));
  return { ...target, bounds, artboardOffset: { x, y } };
}

async function readMeasuredBounds(
  layer: CandidateTargetLayer,
  preferred: GeometrySource,
  onAudit: ((message: string) => void) | undefined,
  stage: string
): Promise<SmartObjectTransformBounds> {
  if (preferred === "dom") {
    const dom = readDomBounds(layer);
    if (dom) return dom;
    onAudit?.(JSON.stringify({ stage: `${stage}.fallback`, requested: "dom", using: "transform" }));
    return (await readSmartObjectGeometry(layer.id)).bounds;
  }
  try {
    return (await readSmartObjectGeometry(layer.id)).bounds;
  } catch (error) {
    const dom = readDomBounds(layer);
    if (!dom) throw error;
    onAudit?.(JSON.stringify({ stage: `${stage}.fallback`, requested: "transform", using: "dom" }));
    return dom;
  }
}

function readDomBounds(layer: CandidateTargetLayer): SmartObjectTransformBounds | undefined {
  try {
    const source = layer.boundsNoEffects;
    if (!source) return undefined;
    const bounds = {
      left: Number(source.left),
      top: Number(source.top),
      right: Number(source.right),
      bottom: Number(source.bottom)
    };
    if (!Object.values(bounds).every(Number.isFinite)) return undefined;
    if (!(bounds.right > bounds.left) || !(bounds.bottom > bounds.top)) return undefined;
    return bounds;
  } catch {
    return undefined;
  }
}

function targetByIds(
  document: CandidateTargetDocument,
  ids: TargetIds
): EditableCanvasTarget {
  const target = findEditableCanvasTargetByIds(document, ids.artboardId, ids.layerId);
  if (!target) {
    throw new Error(`回填过程中未找到目标画板 ${ids.artboardId} 的智能对象图层 ${ids.layerId}。`);
  }
  return target;
}

function strictTargetByIds(
  document: CandidateTargetDocument,
  ids: TargetIds
): EditableCanvasTarget {
  const target = topLevelLayers(document).flatMap((artboard) => (
    artboard.id === ids.artboardId
      ? findEditableCanvasTargets(document, artboard.name).filter((candidate) => (
          candidate.artboard.id === ids.artboardId && candidate.layer.id === ids.layerId
        ))
      : []
  ))[0];
  if (!target) {
    throw new Error(`新建智能对象 ${ids.layerId} 未进入目标画板 ${ids.artboardId}，已撤销本次回填。`);
  }
  return target;
}

function stableExpectedTarget(
  document: CandidateTargetDocument,
  assetCode: string,
  expected: CandidateBackfillTarget
): EditableCanvasTarget | undefined {
  const targets = findEditableCanvasTargets(document, assetCode);
  if (targets.length !== 1) return undefined;
  const target = targets[0]!;
  if (
    target.artboard.id !== expected.artboardId
    || target.layer.id !== expected.targetLayerId
    || !isEditableCanvasLayerName(target.layer.name)
    || !hasExpectedReference(target.artboard, expected)
  ) return undefined;
  return target;
}

type StableBackfillScope =
  | { mode: "existing"; target: EditableCanvasTarget }
  | { mode: "missing"; artboard: CandidateTargetLayer };

function stableExpectedBackfillScope(
  document: CandidateTargetDocument,
  assetCode: string,
  expected: CandidateBackfillTarget
): StableBackfillScope | undefined {
  if (Number.isInteger(expected.targetLayerId)) {
    const target = stableExpectedTarget(document, assetCode, expected);
    return target ? { mode: "existing", target } : undefined;
  }
  if (expected.targetIssue !== "missing") return undefined;
  const matchingArtboards = topLevelLayers(document).filter((layer) => layer.name === assetCode);
  if (matchingArtboards.length !== 1) return undefined;
  const artboard = matchingArtboards[0]!;
  if (
    artboard.id !== expected.artboardId
    || !hasExpectedReference(artboard, expected)
    || findEditableCanvasTargets(document, assetCode).length !== 0
  ) return undefined;
  return { mode: "missing", artboard };
}

function hasExpectedReference(
  artboard: CandidateTargetLayer,
  expected: CandidateBackfillTarget
): boolean {
  if (expected.referenceLayerId === undefined) return expected.referenceIssue === "missing";
  return hasDirectLayerId(artboard, expected.referenceLayerId);
}

function hasDirectLayerId(artboard: CandidateTargetLayer, layerId: number): boolean {
  const layers = artboard.layers;
  if (!layers) return false;
  for (let index = 0; index < layers.length; index += 1) {
    const layer = layers[index];
    if (layer?.id === layerId && !isEditableCanvasLayerName(layer.name)) return true;
  }
  return false;
}

function topLevelLayers(document: CandidateTargetDocument): CandidateTargetLayer[] {
  const layers = new Map<number, CandidateTargetLayer>();
  for (const collection of [document.layers, document.artboards]) {
    if (!collection) continue;
    for (let index = 0; index < collection.length; index += 1) {
      const layer = collection[index];
      if (layer) layers.set(layer.id, layer);
    }
  }
  return Array.from(layers.values());
}

function formatAudit(stage: string, document: CandidateTargetDocument, target: EditableCanvasTarget): string {
  return JSON.stringify({
    stage,
    documentId: document.id ?? null,
    artboard: { id: target.artboard.id, name: target.artboard.name },
    layer: { id: target.layer.id, name: target.layer.name },
    layerPath: target.path.map((layer) => ({ id: layer.id, name: layer.name }))
  });
}

function formatMissingTargetAudit(
  stage: string,
  document: CandidateTargetDocument,
  artboard: CandidateTargetLayer
): string {
  return JSON.stringify({
    stage,
    documentId: document.id ?? null,
    artboard: { id: artboard.id, name: artboard.name },
    layer: null
  });
}

function formatGeometryAudit(snapshot: GeometrySnapshot): string {
  return JSON.stringify({
    stage: snapshot.stage,
    documentId: snapshot.documentId ?? null,
    artboard: { id: snapshot.artboardId, name: snapshot.artboardName },
    layer: { id: snapshot.layerId, name: snapshot.layerName },
    layerPath: snapshot.layerPath,
    artboardRect: compactRect(snapshot.artboardDescriptorBounds),
    artboardDomBounds: snapshot.artboardDomBounds ? compactRect(snapshot.artboardDomBounds) : null,
    layerDomBounds: snapshot.layerDomBounds ? compactRect(snapshot.layerDomBounds) : null,
    smartObject: snapshot.smartObject ? {
      source: snapshot.smartObject.source,
      points: snapshot.smartObject.points.map(rounded),
      bounds: compactRect(snapshot.smartObject.bounds)
    } : null,
    smartObjectError: snapshot.smartObjectError ?? null
  });
}

function compactRect(bounds: SmartObjectTransformBounds) {
  return {
    left: rounded(bounds.left),
    top: rounded(bounds.top),
    right: rounded(bounds.right),
    bottom: rounded(bounds.bottom),
    width: rounded(bounds.right - bounds.left),
    height: rounded(bounds.bottom - bounds.top),
    centerX: rounded((bounds.left + bounds.right) / 2),
    centerY: rounded((bounds.top + bounds.bottom) / 2)
  };
}

function rectOverflow(inner: SmartObjectTransformBounds, outer: SmartObjectTransformBounds) {
  return {
    left: Math.max(0, outer.left - inner.left),
    top: Math.max(0, outer.top - inner.top),
    right: Math.max(0, inner.right - outer.right),
    bottom: Math.max(0, inner.bottom - outer.bottom)
  };
}

function compactOverflow(overflow: ReturnType<typeof rectOverflow>) {
  return Object.fromEntries(Object.entries(overflow).map(([key, value]) => [key, rounded(value)]));
}

function rounded(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function activeDocument(): CandidateTargetDocument | null {
  try {
    return app.activeDocument as unknown as CandidateTargetDocument;
  } catch {
    return null;
  }
}

function extensionFromContentType(contentType: string | null): string {
  if (/jpe?g/i.test(contentType ?? "")) return "jpg";
  if (/webp/i.test(contentType ?? "")) return "webp";
  return "png";
}

function safeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 80) || "candidate";
}
