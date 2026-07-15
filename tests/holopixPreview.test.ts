import { describe, expect, it } from "vitest";
import {
  buildHolopixPreviewUrl,
  encodeHolopixPreviewDataUrl,
  HOLOPIX_PREVIEW_MAX_BYTES,
  readPngDimensions
} from "../src/ai/holopixPreview";

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0);
  bytes.set([0, 0, 0, 13, 73, 72, 68, 82], 8);
  for (let index = 0; index < 4; index += 1) {
    bytes[16 + index] = (width >>> ((3 - index) * 8)) & 0xff;
    bytes[20 + index] = (height >>> ((3 - index) * 8)) & 0xff;
  }
  return bytes;
}

describe("Holopix safe previews", () => {
  it("requests the exact ComfyUI temporary thumbnail without server-side re-encoding", () => {
    const url = new URL(buildHolopixPreviewUrl({
      filename: "candidate 1.png",
      subfolder: "Holopix/ChessGo",
      type: "output"
    }, "http://127.0.0.1:8188"));

    expect(url.pathname).toBe("/view");
    expect(url.searchParams.get("filename")).toBe("candidate 1.png");
    expect(url.searchParams.get("subfolder")).toBe("Holopix/ChessGo");
    expect(url.searchParams.get("type")).toBe("output");
    expect(url.searchParams.has("preview")).toBe(false);
    expect(url.searchParams.has("channel")).toBe(false);
  });

  it("encodes only true 96x96 PNG thumbnails as data URLs", () => {
    const thumbnail = pngHeader(96, 96);
    expect(readPngDimensions(thumbnail)).toEqual({ width: 96, height: 96 });
    expect(encodeHolopixPreviewDataUrl(thumbnail, "image/png")).toMatch(/^data:image\/png;base64,/);
    expect(() => encodeHolopixPreviewDataUrl(pngHeader(1024, 992), "image/png"))
      .toThrow(/必须为 96×96/);
    expect(() => encodeHolopixPreviewDataUrl(
      new Uint8Array(HOLOPIX_PREVIEW_MAX_BYTES + 1),
      "image/png"
    )).toThrow(/安全上限/);
    expect(() => encodeHolopixPreviewDataUrl(thumbnail, "image/jpeg"))
      .toThrow(/格式无效/);
    expect(() => readPngDimensions(new Uint8Array([1, 2, 3])))
      .toThrow(/有效的 PNG/);
  });
});
