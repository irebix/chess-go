import type {
  CenterlineCoordinate,
  CenterlinePathJson,
  CenterlinePixelSource,
  CenterlinePixelTransform,
  CenterlineSubpath
} from "./types";

export function createCenterlinePathTransform(
  pathJson: CenterlinePathJson,
  pixels: CenterlinePixelSource
): CenterlinePixelTransform {
  return {
    scaleX: pixels.transform.scaleX * (pixels.width / pathJson.canvas.width),
    scaleY: pixels.transform.scaleY * (pixels.height / pathJson.canvas.height),
    offsetX: pixels.transform.offsetX,
    offsetY: pixels.transform.offsetY
  };
}

function cubicPoint(
  p0: CenterlineCoordinate,
  p1: CenterlineCoordinate,
  p2: CenterlineCoordinate,
  p3: CenterlineCoordinate,
  t: number
): CenterlineCoordinate {
  const u = 1 - t;
  const uu = u * u;
  const tt = t * t;
  return [
    (uu * u * p0[0]) + (3 * uu * t * p1[0]) + (3 * u * tt * p2[0]) + (tt * t * p3[0]),
    (uu * u * p0[1]) + (3 * uu * t * p1[1]) + (3 * u * tt * p2[1]) + (tt * t * p3[1])
  ];
}

function sampleClosedPath(path: CenterlineSubpath, stepsPerSegment = 12): CenterlineCoordinate[] {
  if (!path.closed || path.points.length < 3) return [];
  const sampled: CenterlineCoordinate[] = [];
  for (let index = 0; index < path.points.length; index += 1) {
    const current = path.points[index]!;
    const next = path.points[(index + 1) % path.points.length]!;
    for (let step = 0; step < stepsPerSegment; step += 1) {
      sampled.push(cubicPoint(
        current.anchor,
        current.rightDirection,
        next.leftDirection,
        next.anchor,
        step / stepsPerSegment
      ));
    }
  }
  return sampled;
}

function absolutePolygonArea(polygon: CenterlineCoordinate[]): number {
  let twiceArea = 0;
  for (let index = 0; index < polygon.length; index += 1) {
    const current = polygon[index]!;
    const next = polygon[(index + 1) % polygon.length]!;
    twiceArea += (current[0] * next[1]) - (next[0] * current[1]);
  }
  return Math.abs(twiceArea) * 0.5;
}

function pointInPolygon(point: CenterlineCoordinate, polygon: CenterlineCoordinate[]): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index, index += 1) {
    const current = polygon[index]!;
    const prior = polygon[previous]!;
    const crossesRay = (current[1] > point[1]) !== (prior[1] > point[1]);
    if (!crossesRay) continue;
    const crossingX = ((prior[0] - current[0]) * (point[1] - current[1])) / (prior[1] - current[1]) + current[0];
    if (point[0] < crossingX) inside = !inside;
  }
  return inside;
}

export function classifyNestedSubpaths(paths: CenterlineSubpath[]): Array<"add" | "subtract"> {
  const outlines = paths.map((path) => sampleClosedPath(path));
  const areas = outlines.map((outline) => absolutePolygonArea(outline));
  return paths.map((path, pathIndex) => {
    const outline = outlines[pathIndex]!;
    if (!path.closed || !outline.length) return "add";
    const probe = path.points[0]!.anchor;
    let containingDepth = 0;
    for (let candidateIndex = 0; candidateIndex < paths.length; candidateIndex += 1) {
      if (candidateIndex === pathIndex) continue;
      const candidateOutline = outlines[candidateIndex]!;
      if (!candidateOutline.length) continue;
      if (areas[candidateIndex]! <= areas[pathIndex]! + 1e-6) continue;
      if (pointInPolygon(probe, candidateOutline)) containingDepth += 1;
    }
    return containingDepth % 2 === 1 ? "subtract" : "add";
  });
}
