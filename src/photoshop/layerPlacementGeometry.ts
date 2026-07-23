import { constants } from "photoshop";
import type { GridRect } from "../grid/GridGeometry";

export interface TransformableLayerLike {
  id: number;
  name: string;
  boundsNoEffects?: GridRect;
  bounds?: GridRect;
  layers?: LayerCollectionLike;
  scale(horizontal: number, vertical: number, anchor: unknown): Promise<void> | void;
  translate(horizontal: number, vertical: number): Promise<void> | void;
  move?(relativeObject: unknown, placement: string): Promise<void> | void;
  delete?(): Promise<void> | void;
}

export interface LayerCollectionLike {
  length: number;
  [index: number]: TransformableLayerLike;
}

export interface LayerDocumentLike {
  layers: LayerCollectionLike;
}

export interface LayerAlignmentResult {
  bounds: GridRect;
  centerErrorX: number;
  centerErrorY: number;
  overflow: { left: number; top: number; right: number; bottom: number };
}

export async function fitLayerInsideBounds(
  layer: TransformableLayerLike,
  target: GridRect,
  options: { allowUpscale?: boolean; tolerance?: number } = {}
): Promise<LayerAlignmentResult> {
  const source = numericLayerBounds(layer);
  const sourceWidth = source.right - source.left;
  const sourceHeight = source.bottom - source.top;
  const targetWidth = target.right - target.left;
  const targetHeight = target.bottom - target.top;
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) throw new Error("置入图层边界为空。");
  if (!(targetWidth > 0) || !(targetHeight > 0)) throw new Error("目标边界为空。");
  const containScale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const scale = options.allowUpscale ? containScale : Math.min(1, containScale);
  if (Math.abs(scale - 1) > 0.0001) {
    await layer.scale(scale * 100, scale * 100, constants.AnchorPosition.MIDDLECENTER);
  }
  await centerLayerInBounds(layer, target);
  let result = measureLayerAlignment(layer, target);
  const tolerance = options.tolerance ?? 1;
  if (
    (Math.abs(result.centerErrorX) > 0.5 || Math.abs(result.centerErrorY) > 0.5)
    && typeof layer.translate === "function"
  ) {
    await layer.translate(result.centerErrorX, result.centerErrorY);
    result = measureLayerAlignment(layer, target);
  }
  if (
    Math.abs(result.centerErrorX) > tolerance ||
    Math.abs(result.centerErrorY) > tolerance ||
    Object.values(result.overflow).some((value) => value > tolerance)
  ) {
    throw new Error("置入图层未能安全限制在目标边界内。");
  }
  return result;
}

export async function alignResultToSource(
  document: LayerDocumentLike,
  resultLayerId: number,
  sourceLayerId: number,
  sourceBounds?: GridRect,
  options: { fit?: "contain" | "preserve"; allowUpscale?: boolean; moveAbove?: boolean } = {}
): Promise<LayerAlignmentResult | undefined> {
  let resultLayer = findLayerById(document.layers, resultLayerId);
  const sourceLayer = findLayerById(document.layers, sourceLayerId);
  if (!sourceLayer) throw new Error("来源图层已不存在。");
  if (!resultLayer) throw new Error("插入结果图层已不存在。");
  if ((options.moveAbove ?? true) && resultLayer.move) {
    await resultLayer.move(sourceLayer, constants.ElementPlacement.PLACEBEFORE);
    resultLayer = findLayerById(document.layers, resultLayerId);
    if (!resultLayer) throw new Error("结果图层移动到来源上方后无法重新定位。");
  }
  if ((options.fit ?? "contain") === "preserve") {
    numericLayerBounds(resultLayer);
    return undefined;
  }
  return fitLayerInsideBounds(
    resultLayer,
    sourceBounds ?? numericLayerBounds(sourceLayer),
    { allowUpscale: options.allowUpscale ?? true }
  );
}

export function findLayerById(
  collection: LayerCollectionLike | undefined,
  layerId: number
): TransformableLayerLike | null {
  if (!collection) return null;
  for (let index = 0; index < collection.length; index += 1) {
    const layer = collection[index];
    if (!layer) continue;
    if (layer.id === layerId) return layer;
    const nested = findLayerById(layer.layers, layerId);
    if (nested) return nested;
  }
  return null;
}

export function numericLayerBounds(layer: TransformableLayerLike): GridRect {
  const source = layer.boundsNoEffects ?? layer.bounds;
  if (!source) throw new Error("Photoshop 未返回图层边界。");
  const bounds = {
    left: Number(source.left),
    top: Number(source.top),
    right: Number(source.right),
    bottom: Number(source.bottom)
  };
  if (
    !Object.values(bounds).every(Number.isFinite) ||
    !(bounds.right > bounds.left) ||
    !(bounds.bottom > bounds.top)
  ) {
    throw new Error("Photoshop 返回的图层边界无效。");
  }
  return bounds;
}

function measureLayerAlignment(
  layer: TransformableLayerLike,
  target: GridRect
): LayerAlignmentResult {
  const bounds = numericLayerBounds(layer);
  const centerErrorX = (target.left + target.right) / 2 - (bounds.left + bounds.right) / 2;
  const centerErrorY = (target.top + target.bottom) / 2 - (bounds.top + bounds.bottom) / 2;
  return {
    bounds,
    centerErrorX,
    centerErrorY,
    overflow: {
      left: Math.max(0, target.left - bounds.left),
      top: Math.max(0, target.top - bounds.top),
      right: Math.max(0, bounds.right - target.right),
      bottom: Math.max(0, bounds.bottom - target.bottom)
    }
  };
}

async function centerLayerInBounds(layer: TransformableLayerLike, target: GridRect): Promise<void> {
  const bounds = numericLayerBounds(layer);
  const dx = (target.left + target.right) / 2 - (bounds.left + bounds.right) / 2;
  const dy = (target.top + target.bottom) / 2 - (bounds.top + bounds.bottom) / 2;
  if (Math.abs(dx) > 0.01 || Math.abs(dy) > 0.01) await layer.translate(dx, dy);
}
