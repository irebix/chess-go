import { calculateContainTransform, type Rect } from "./contain";

export interface AiCandidatePlacement {
  scale: number;
  targetCenterX: number;
  targetCenterY: number;
}

export function artboardBoundsFromDescriptor(descriptor: unknown): Rect {
  const root = asRecord(descriptor);
  const artboard = asRecord(root.artboard);
  const rect = asRecord(artboard.artboardRect ?? root.artboardRect);
  const bounds = {
    left: Number(rect.left),
    top: Number(rect.top),
    right: Number(rect.right),
    bottom: Number(rect.bottom)
  };
  if (!Object.values(bounds).every(Number.isFinite)) {
    throw new Error("Photoshop 未返回有效的画板边界。");
  }
  if (!(bounds.right > bounds.left) || !(bounds.bottom > bounds.top)) {
    throw new Error("Photoshop 返回的画板边界为空。");
  }
  return bounds;
}

export function calculateAiCandidatePlacement(
  source: Rect,
  target: Rect
): AiCandidatePlacement {
  const targetWidth = target.right - target.left;
  const targetHeight = target.bottom - target.top;
  const targetCenterX = (target.left + target.right) / 2;
  const targetCenterY = (target.top + target.bottom) / 2;
  const transform = calculateContainTransform({
    source,
    maxWidth: targetWidth,
    maxHeight: targetHeight,
    targetCenterX,
    targetCenterY,
    allowUpscale: true
  });
  return {
    scale: transform.scale,
    targetCenterX,
    targetCenterY
  };
}

export function rebaseTargetBoundsAfterArtboardShift(
  target: Rect,
  artboardBefore: Rect,
  artboardAfter: Rect
): Rect {
  const offsetX = artboardAfter.left - artboardBefore.left;
  const offsetY = artboardAfter.top - artboardBefore.top;
  return {
    left: target.left + offsetX,
    top: target.top + offsetY,
    right: target.right + offsetX,
    bottom: target.bottom + offsetY
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
