import { describe, expect, it } from "vitest";
import {
  buildHolopixPreviewUrl,
  encodeHolopixPreviewDataUrl,
  HOLOPIX_PREVIEW_MAX_BYTES
} from "../src/ai/holopixPreview";

describe("Holopix safe previews", () => {
  it("requests a compact JPEG preview while preserving output identity", () => {
    const url = new URL(buildHolopixPreviewUrl({
      filename: "candidate 1.png",
      subfolder: "Holopix/ChessGo",
      type: "output"
    }, "http://127.0.0.1:8188"));

    expect(url.pathname).toBe("/view");
    expect(url.searchParams.get("filename")).toBe("candidate 1.png");
    expect(url.searchParams.get("subfolder")).toBe("Holopix/ChessGo");
    expect(url.searchParams.get("type")).toBe("output");
    expect(url.searchParams.get("preview")).toBe("jpeg;70");
    expect(url.searchParams.get("channel")).toBe("rgb");
  });

  it("encodes only bounded image payloads as data URLs", () => {
    expect(encodeHolopixPreviewDataUrl(new Uint8Array([0, 1, 2, 255]), "image/jpeg; charset=binary"))
      .toBe("data:image/jpeg;base64,AAEC/w==");
    expect(() => encodeHolopixPreviewDataUrl(
      new Uint8Array(HOLOPIX_PREVIEW_MAX_BYTES + 1),
      "image/jpeg"
    )).toThrow(/安全上限/);
    expect(() => encodeHolopixPreviewDataUrl(new Uint8Array([1]), "text/html"))
      .toThrow(/格式无效/);
  });
});
