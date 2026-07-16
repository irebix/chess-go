export interface SmartObjectTransformBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SmartObjectTransformGeometry {
  source: "transform" | "nonAffineTransform";
  points: number[];
  bounds: SmartObjectTransformBounds;
}

export function smartObjectBoundsFromDescriptor(descriptor: unknown): SmartObjectTransformBounds {
  return smartObjectGeometryFromDescriptor(descriptor).bounds;
}

export function smartObjectGeometryFromDescriptor(descriptor: unknown): SmartObjectTransformGeometry {
  const root = asRecord(descriptor);
  const smartObjectMore = asRecord(root.smartObjectMore ?? root);
  const source = Array.isArray(smartObjectMore.transform) ? "transform" : "nonAffineTransform";
  const transform = smartObjectMore[source];
  if (!Array.isArray(transform) || transform.length < 8) {
    throw new Error("Photoshop 未返回空白智能对象的变换四角。");
  }

  const values = transform.slice(0, 8).map(Number);
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error("Photoshop 返回了无效的空白智能对象变换数据。");
  }
  const xs = [values[0]!, values[2]!, values[4]!, values[6]!];
  const ys = [values[1]!, values[3]!, values[5]!, values[7]!];
  return {
    source,
    points: values,
    bounds: {
      left: Math.min(...xs),
      top: Math.min(...ys),
      right: Math.max(...xs),
      bottom: Math.max(...ys)
    }
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}
