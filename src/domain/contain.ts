export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface ContainInput {
  source: Rect;
  maxWidth: number;
  maxHeight: number;
  targetCenterX: number;
  targetCenterY: number;
  allowUpscale: boolean;
  pixelEnvelopeMargin?: number;
}

export interface ContainTransform {
  scale: number;
  translateX: number;
  translateY: number;
}

export function calculateContainTransform(input: ContainInput): ContainTransform {
  const width = input.source.right - input.source.left;
  const height = input.source.bottom - input.source.top;
  if (!(width > 0) || !(height > 0)) {
    throw new Error("无法对空图层边界进行缩放。")
  }
  if (!(input.maxWidth > 0) || !(input.maxHeight > 0)) {
    throw new Error("内容框宽高必须大于 0。")
  }

  const margin = input.pixelEnvelopeMargin ?? 0;
  if (!(margin >= 0) || margin >= Math.min(input.maxWidth, input.maxHeight)) {
    throw new Error("像素边界安全值必须大于等于 0，并小于内容框宽高。")
  }
  const safeMaxWidth = input.maxWidth - margin;
  const safeMaxHeight = input.maxHeight - margin;
  const rawScale = Math.min(safeMaxWidth / width, safeMaxHeight / height);
  const scale = input.allowUpscale ? rawScale : Math.min(rawScale, 1);
  const currentCenterX = (input.source.left + input.source.right) / 2;
  const currentCenterY = (input.source.top + input.source.bottom) / 2;

  return {
    scale,
    translateX: input.targetCenterX - currentCenterX,
    translateY: input.targetCenterY - currentCenterY
  };
}
