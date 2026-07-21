import {
  CENTERLINE_MAX_CLIENT_ANCHORS,
  CENTERLINE_MAX_CLIENT_PATHS
} from "./config";
import type {
  CenterlineCoordinate,
  CenterlinePathJson,
  CenterlinePathPoint,
  CenterlineSubpath
} from "./types";

function finitePair(value: unknown, label: string, absoluteLimit: number | null = null): CenterlineCoordinate {
  if (!Array.isArray(value) || value.length !== 2) {
    throw new Error(`${label} 必须是两个坐标值。`);
  }
  const pair: CenterlineCoordinate = [Number(value[0]), Number(value[1])];
  if (!pair.every(Number.isFinite)) throw new Error(`${label} 含有非法坐标。`);
  if (absoluteLimit !== null && pair.some((number) => Math.abs(number) > absoluteLimit)) {
    throw new Error(`${label} 超过坐标安全范围。`);
  }
  return pair;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validatePathJson(payload: unknown): CenterlinePathJson {
  if (!isRecord(payload) || payload.format !== "photoshop-path-json") {
    throw new Error("结果不是受支持的 Photoshop Path JSON。");
  }
  const canvas = isRecord(payload.canvas) ? payload.canvas : null;
  const canvasWidth = Number(canvas?.width);
  const canvasHeight = Number(canvas?.height);
  if (!Number.isFinite(canvasWidth) || !Number.isFinite(canvasHeight) || canvasWidth <= 0 || canvasHeight <= 0) {
    throw new Error("路径结果缺少有效画布尺寸。");
  }
  const coordinateLimit = Math.max(canvasWidth, canvasHeight) * 16 + 10_000;
  if (!Array.isArray(payload.paths) || payload.paths.length === 0) {
    throw new Error("结果中没有可编辑路径。");
  }
  if (payload.paths.length > CENTERLINE_MAX_CLIENT_PATHS) {
    throw new Error(`路径数量超过客户端安全上限 ${CENTERLINE_MAX_CLIENT_PATHS}。`);
  }

  let anchorCount = 0;
  const paths: CenterlineSubpath[] = payload.paths.map((pathValue, pathIndex) => {
    if (!isRecord(pathValue) || !Array.isArray(pathValue.points) || pathValue.points.length < 2) {
      throw new Error(`第 ${pathIndex + 1} 条路径的锚点不足。`);
    }
    anchorCount += pathValue.points.length;
    if (anchorCount > CENTERLINE_MAX_CLIENT_ANCHORS) {
      throw new Error(`锚点数量超过客户端安全上限 ${CENTERLINE_MAX_CLIENT_ANCHORS}。`);
    }
    const points: CenterlinePathPoint[] = pathValue.points.map((pointValue, pointIndex) => {
      if (!isRecord(pointValue)) {
        throw new Error(`path[${pathIndex}].point[${pointIndex}] 格式无效。`);
      }
      return {
        anchor: finitePair(pointValue.anchor, `path[${pathIndex}].point[${pointIndex}].anchor`, coordinateLimit),
        leftDirection: finitePair(
          pointValue.leftDirection,
          `path[${pathIndex}].point[${pointIndex}].leftDirection`,
          coordinateLimit
        ),
        rightDirection: finitePair(
          pointValue.rightDirection,
          `path[${pathIndex}].point[${pointIndex}].rightDirection`,
          coordinateLimit
        ),
        kind: typeof pointValue.kind === "string" ? pointValue.kind : undefined
      };
    });
    return { closed: Boolean(pathValue.closed), points };
  });

  return {
    ...payload,
    format: "photoshop-path-json",
    canvas: { width: canvasWidth, height: canvasHeight },
    paths
  } as CenterlinePathJson;
}

export function removeCenterlineCanvasPadding(
  pathJson: CenterlinePathJson,
  padding: number
): CenterlinePathJson {
  if (!Number.isInteger(padding) || padding < 0) throw new Error("AI勾线路径扩边尺寸无效。");
  if (padding === 0) return pathJson;
  const width = pathJson.canvas.width - padding * 2;
  const height = pathJson.canvas.height - padding * 2;
  if (width < 1 || height < 1) throw new Error("AI勾线路径画布小于扩边尺寸。");
  const shift = (coordinate: CenterlineCoordinate): CenterlineCoordinate => [
    coordinate[0] - padding,
    coordinate[1] - padding
  ];
  return {
    ...pathJson,
    canvas: { width, height },
    paths: pathJson.paths.map((path) => ({
      ...path,
      points: path.points.map((point) => ({
        ...point,
        anchor: shift(point.anchor),
        leftDirection: shift(point.leftDirection),
        rightDirection: shift(point.rightDirection)
      }))
    }))
  };
}
