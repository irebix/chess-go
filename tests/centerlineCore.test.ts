import { describe, expect, it } from "vitest";
import { pixelsToPpm } from "../src/centerline/client";
import { classifyNestedSubpaths } from "../src/centerline/pathGeometry";
import type { CenterlineCoordinate, CenterlinePixelSource, CenterlineSubpath } from "../src/centerline/types";

function pixelSource(bytes: number[], components: number, width = 1, height = 1): CenterlinePixelSource {
  return {
    documentId: 1,
    documentName: "test.psd",
    layerId: 2,
    layerName: "Layer 1",
    bytes: Uint8Array.from(bytes),
    width,
    height,
    components,
    transform: { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 }
  };
}

function square(left: number, top: number, right: number, bottom: number): CenterlineSubpath {
  const anchors: CenterlineCoordinate[] = [
    [left, top],
    [right, top],
    [right, bottom],
    [left, bottom]
  ];
  return {
    closed: true,
    points: anchors.map((anchor) => ({
      anchor,
      leftDirection: anchor,
      rightDirection: anchor,
      kind: "corner"
    }))
  };
}

describe("Centerline core helpers", () => {
  it("encodes RGB pixels as a binary P6 PPM", () => {
    const ppm = pixelsToPpm(pixelSource([10, 20, 30], 3));
    const header = new TextDecoder().decode(ppm.slice(0, 11));

    expect(header).toBe("P6\n1 1\n255\n");
    expect(Array.from(ppm.slice(11))).toEqual([10, 20, 30]);
  });

  it("composites transparent layer pixels onto white", () => {
    const ppm = pixelsToPpm(pixelSource([255, 0, 0, 128], 4));

    expect(Array.from(ppm.slice(11))).toEqual([255, 127, 127]);
  });

  it("marks nested closed paths as subtractive holes", () => {
    expect(classifyNestedSubpaths([
      square(0, 0, 100, 100),
      square(20, 20, 80, 80),
      square(40, 40, 60, 60)
    ])).toEqual(["add", "subtract", "add"]);
  });

  it("keeps open paths additive", () => {
    const openPath = { ...square(0, 0, 10, 10), closed: false };
    expect(classifyNestedSubpaths([openPath])).toEqual(["add"]);
  });
});
