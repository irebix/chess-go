import { describe, expect, it } from "vitest";
import { normalizeArchivePath, normalizeZipEntryName } from "../src/infrastructure/xlsx/paths";

describe("OOXML path normalization", () => {
  it("resolves Tencent drawing media paths", () => {
    expect(normalizeArchivePath("xl/drawings/drawing8.xml", "media/image2108.png")).toBe(
      "xl/drawings/media/image2108.png"
    );
  });

  it("resolves standard media paths", () => {
    expect(normalizeArchivePath("xl/drawings/drawing1.xml", "../media/image1.png")).toBe(
      "xl/media/image1.png"
    );
  });

  it("normalizes separators and a leading slash", () => {
    expect(normalizeZipEntryName("\\xl\\drawings\\media\\image1.png")).toBe(
      "xl/drawings/media/image1.png"
    );
  });
});
