import { describe, expect, it } from "vitest";
import { rgbOrRgbaToRgba } from "../src/domain/imagePixels";

describe("PSD reference raw pixels", () => {
  it("adds opaque alpha to RGB pixels", () => {
    expect(Array.from(rgbOrRgbaToRgba(
      new Uint8Array([10, 20, 30, 40, 50, 60]),
      2,
      1,
      3
    ))).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
  });

  it("copies RGBA pixels without sharing the source buffer", () => {
    const source = new Uint8Array([10, 20, 30, 40]);
    const result = rgbOrRgbaToRgba(source, 1, 1, 4);
    source[0] = 99;
    expect(Array.from(result)).toEqual([10, 20, 30, 40]);
  });

  it("rejects mismatched dimensions and component counts", () => {
    expect(() => rgbOrRgbaToRgba(new Uint8Array(3), 1, 1, 4)).toThrow(/格式无效/);
    expect(() => rgbOrRgbaToRgba(new Uint8Array(2), 1, 1, 2)).toThrow(/格式无效/);
  });
});
