import { describe, expect, it } from "vitest";
import {
  GRID_PREFIX,
  parseGridMetadata,
  serializeGridMetadata,
  standardGridMetadata,
  validateGridMetadata
} from "../src/grid/GridMetadata";

describe("standard grid metadata", () => {
  it("encodes and reads the supported template", () => {
    const encoded = serializeGridMetadata();
    expect(encoded.startsWith(GRID_PREFIX)).toBe(true);
    expect(parseGridMetadata(encoded)).toEqual({
      status: "valid",
      metadata: standardGridMetadata()
    });
  });

  it("rejects invalid schema and version", () => {
    expect(() => serializeGridMetadata({ ...standardGridMetadata(), schema: "wrong" as "chess-go-grid" }))
      .toThrow(/schema/);
    expect(() => serializeGridMetadata({ ...standardGridMetadata(), version: 2 as 1 }))
      .toThrow(/version/);
  });

  it("rejects a formula mismatch and current document size mismatch", () => {
    const wrongFormula = standardGridMetadata();
    wrongFormula.grid.gapX = 5;
    expect(() => validateGridMetadata(wrongFormula)).toThrow(/尺寸公式/);
    expect(() => validateGridMetadata(standardGridMetadata(), { width: 1780, height: 1200 }))
      .toThrow("网格配置与当前画布尺寸不一致，已停止自动定位。");
  });

  it("reports metadata from a newer plugin version", () => {
    expect(parseGridMetadata("chess-go-grid-v2:AAAA")).toEqual({
      status: "unsupported-version",
      version: 2
    });
  });
});
