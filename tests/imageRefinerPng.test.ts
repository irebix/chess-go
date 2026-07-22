import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { pixelsToPng } from "../src/imageRefiner/png";
import type { CenterlinePixelSource } from "../src/centerline/types";

function pixelSource(bytes: number[], components: number, width = 1, height = 1): CenterlinePixelSource {
  return {
    documentId: 1,
    documentName: "test.psd",
    layerId: 2,
    layerName: "layer",
    bytes: Uint8Array.from(bytes),
    width,
    height,
    components,
    transform: { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 }
  };
}

function pngPayload(png: Uint8Array): { width: number; height: number; scanlines: Uint8Array } {
  let offset = 8;
  let width = 0;
  let height = 0;
  const idat: Uint8Array[] = [];
  while (offset < png.byteLength) {
    const view = new DataView(png.buffer, png.byteOffset + offset, 8);
    const length = view.getUint32(0);
    const type = String.fromCharCode(...png.subarray(offset + 4, offset + 8));
    const data = png.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      const header = new DataView(data.buffer, data.byteOffset, data.byteLength);
      width = header.getUint32(0);
      height = header.getUint32(4);
      expect(Array.from(data.subarray(8))).toEqual([8, 6, 0, 0, 0]);
    }
    if (type === "IDAT") idat.push(data);
    offset += 12 + length;
  }
  const compressed = Buffer.concat(idat.map((part) => Buffer.from(part)));
  return { width, height, scanlines: new Uint8Array(inflateSync(compressed)) };
}

describe("AI image refiner PNG upload", () => {
  it("encodes exact RGBA pixels so transparent layer content reaches the pack node", () => {
    const png = pixelsToPng(pixelSource([10, 20, 30, 40, 50, 60, 70, 80], 4, 2, 1));
    expect(Array.from(png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const decoded = pngPayload(png);
    expect(decoded).toMatchObject({ width: 2, height: 1 });
    expect(Array.from(decoded.scanlines)).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80]);
  });

  it("expands grayscale alpha input into RGBA", () => {
    const decoded = pngPayload(pixelsToPng(pixelSource([120, 64], 2)));
    expect(Array.from(decoded.scanlines)).toEqual([0, 120, 120, 120, 64]);
  });
});
