import { action, app, constants, core } from "photoshop";
import { storage } from "uxp";
import {
  artboardBoundsFromDescriptor,
  calculateAiCandidatePlacement
} from "../domain/aiCandidatePlacement";
import { deleteTemporaryFile } from "../infrastructure/filesystem/uxpFiles";
import {
  getArtboardDescriptor,
  replacePlacedLayerContentsDescriptor,
  selectLayerDescriptor
} from "./actionDescriptors";
import {
  findEditableCanvasTargets,
  type CandidateTargetLayer,
  type CandidateTargetDocument,
  type EditableCanvasTarget
} from "./aiCandidateTarget";
import {
  smartObjectGeometryFromDescriptor,
  type SmartObjectTransformBounds,
  type SmartObjectTransformGeometry
} from "./smartObjectBounds";

export interface CandidateBackfillResult {
  applied: boolean;
  detail: string;
}

export async function backfillAiCandidate(
  assetCode: string,
  imageUrl: string,
  onAudit?: (message: string) => void
): Promise<CandidateBackfillResult> {
  const document = activeDocument();
  if (!document) {
    return { applied: false, detail: "候选已选中；当前没有打开的棋子归档 PSD，未回填画板。" };
  }
  const initialTargets = findEditableCanvasTargets(document, assetCode);
  if (!initialTargets.length) {
    return { applied: false, detail: `候选已选中；当前 PSD 中未找到画板 ${assetCode} 的空白智能对象。` };
  }
  if (initialTargets.length > 1) {
    throw new Error(`当前 PSD 中找到 ${initialTargets.length} 个 ${assetCode} 空白智能对象，已停止回填以避免写入错误画板。`);
  }
  onAudit?.(formatAudit("target.initial", document, initialTargets[0]!));

  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`下载 Holopix 候选图失败：HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const extension = extensionFromContentType(response.headers.get("content-type"));
  const folder = await storage.localFileSystem.getTemporaryFolder();
  const temporary = await folder.createFile(
    `chess-go-holopix-${safeFileName(assetCode)}-${Date.now()}.${extension}`,
    { overwrite: true }
  );
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  await temporary.write(copy, { format: storage.formats.binary });

  try {
    const token = storage.localFileSystem.createSessionToken(temporary);
    await core.executeAsModal(
      async () => {
        const currentDocument = activeDocument();
        if (!currentDocument) throw new Error("回填过程中当前 PSD 已关闭。");
        const currentTarget = uniqueTarget(currentDocument, assetCode);
        const before = await captureGeometry(currentDocument, currentTarget, "before-replace");
        onAudit?.(formatGeometryAudit(before));
        const targetMeasurement = chooseTargetMeasurement(before);
        onAudit?.(JSON.stringify({
          stage: "target.measurement",
          source: targetMeasurement.source,
          basis: targetMeasurement.basis,
          bounds: compactRect(targetMeasurement.bounds)
        }));
        await action.batchPlay([
          selectLayerDescriptor(currentTarget.layer.id),
          replacePlacedLayerContentsDescriptor(token)
        ], {});
        const replacedTarget = uniqueTarget(currentDocument, assetCode);
        const afterReplace = await captureGeometry(currentDocument, replacedTarget, "after-replace");
        onAudit?.(formatGeometryAudit(afterReplace));
        await fitReplacementInsideTarget(
          currentDocument,
          assetCode,
          targetMeasurement,
          currentTarget.artboard.id,
          onAudit
        );
        const finalTarget = uniqueTarget(currentDocument, assetCode, currentTarget.artboard.id);
        onAudit?.(formatGeometryAudit(await captureGeometry(currentDocument, finalTarget, "after-placement")));
      },
      { commandName: `回填 Holopix 候选：${assetCode}` }
    );
  } finally {
    await deleteTemporaryFile(temporary);
  }

  return { applied: true, detail: `已选中并回填画板 ${assetCode}；图片已限制在画板范围内。` };
}

async function readArtboardBounds(layerId: number): Promise<SmartObjectTransformBounds> {
  const [descriptor] = await action.batchPlay([getArtboardDescriptor(layerId)], {});
  return artboardBoundsFromDescriptor(descriptor);
}

type GeometrySource = "dom" | "transform";

interface TargetMeasurement {
  source: GeometrySource;
  basis: "artboard-dom" | "layer-dom" | "layer-transform";
  bounds: SmartObjectTransformBounds;
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
  assetCode: string,
  target: TargetMeasurement,
  expectedArtboardId: number,
  onAudit?: (message: string) => void
): Promise<void> {
  let currentTarget = uniqueTarget(document, assetCode, expectedArtboardId);
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
    targetCenter: [rounded(placement.targetCenterX), rounded(placement.targetCenterY)]
  }));
  if (Math.abs(placement.scale - 1) > 0.0001) {
    await layer.scale(
      placement.scale * 100,
      placement.scale * 100,
      constants.AnchorPosition.MIDDLECENTER
    );
  }
  currentTarget = uniqueTarget(document, assetCode, expectedArtboardId);
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

  currentTarget = uniqueTarget(document, assetCode, expectedArtboardId);
  layer = currentTarget.layer;
  let finalBounds = await readMeasuredBounds(layer, target.source, onAudit, "after-translate");
  let errorX = placement.targetCenterX - (finalBounds.left + finalBounds.right) / 2;
  let errorY = placement.targetCenterY - (finalBounds.top + finalBounds.bottom) / 2;
  if ((Math.abs(errorX) > 0.5 || Math.abs(errorY) > 0.5) && layer.translate) {
    onAudit?.(JSON.stringify({ stage: "placement.corrective-translate", dx: rounded(errorX), dy: rounded(errorY) }));
    await layer.translate(errorX, errorY);
    currentTarget = uniqueTarget(document, assetCode, expectedArtboardId);
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
  if (snapshot.artboardDomBounds && rectsNearlyEqual(
    snapshot.artboardDomBounds,
    snapshot.artboardDescriptorBounds,
    1
  )) {
    return { source: "dom", basis: "artboard-dom", bounds: snapshot.artboardDomBounds };
  }
  if (snapshot.layerDomBounds) {
    return { source: "dom", basis: "layer-dom", bounds: snapshot.layerDomBounds };
  }
  if (snapshot.smartObject) {
    return { source: "transform", basis: "layer-transform", bounds: snapshot.smartObject.bounds };
  }
  throw new Error("Photoshop 没有返回原空白智能对象的 DOM 或 transform 边界。");
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

function uniqueTarget(
  document: CandidateTargetDocument,
  assetCode: string,
  expectedArtboardId?: number
): EditableCanvasTarget {
  const matches = findEditableCanvasTargets(document, assetCode);
  if (!matches.length) throw new Error(`回填过程中未找到画板 ${assetCode} 的空白智能对象。`);
  if (matches.length > 1) throw new Error(`回填过程中找到 ${matches.length} 个 ${assetCode} 空白智能对象，已停止以避免写错画板。`);
  const target = matches[0]!;
  if (expectedArtboardId !== undefined && target.artboard.id !== expectedArtboardId) {
    throw new Error(`回填过程中 ${assetCode} 的目标画板发生变化，已停止定位。`);
  }
  return target;
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

function rectsNearlyEqual(
  first: SmartObjectTransformBounds,
  second: SmartObjectTransformBounds,
  tolerance: number
): boolean {
  return Math.abs(first.left - second.left) <= tolerance
    && Math.abs(first.top - second.top) <= tolerance
    && Math.abs(first.right - second.right) <= tolerance
    && Math.abs(first.bottom - second.bottom) <= tolerance;
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
