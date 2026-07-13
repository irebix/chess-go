import { describe, expect, it } from "vitest";
import { columnNumberToLetters, parseA1Address, parseA1Range, isPositionInRange } from "../src/utils/a1";

describe("A1 utilities", () => {
  it("parses addresses beyond column Z", () => {
    expect(parseA1Address("AD150")).toEqual({ row: 150, col: 30 });
    expect(columnNumberToLetters(30)).toBe("AD");
  });

  it("normalizes and checks ranges", () => {
    const range = parseA1Range("D10:B2");
    expect(range).toEqual({ start: { row: 2, col: 2 }, end: { row: 10, col: 4 } });
    expect(isPositionInRange({ row: 3, col: 3 }, range)).toBe(true);
    expect(isPositionInRange({ row: 11, col: 3 }, range)).toBe(false);
  });

  it("rejects zero rows and ranges with too many endpoints", () => {
    expect(() => parseA1Address("A0")).toThrow("无效的 A1 地址");
    expect(() => parseA1Range("A1:B2:C3")).toThrow("无效的 A1 范围");
    expect(() => parseA1Range("B2:")).toThrow("无效的 A1 范围");
    expect(() => parseA1Address("A1048577")).toThrow("无效的 A1 地址");
    expect(() => parseA1Address("XFE1")).toThrow("无效的 A1 地址");
    expect(parseA1Address("$XFD$1048576")).toEqual({ row: 1048576, col: 16384 });
  });
});
