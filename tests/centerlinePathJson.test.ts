import { describe, expect, it } from "vitest";
import { removeCenterlineCanvasPadding, validatePathJson } from "../src/centerline/pathJson";

const point = {
  anchor: [0, 0],
  leftDirection: [0, 0],
  rightDirection: [0, 0],
  kind: "corner"
};

describe("Centerline Path JSON validation", () => {
  it("accepts a bounded Photoshop path payload", () => {
    const result = validatePathJson({
      format: "photoshop-path-json",
      canvas: { width: 620, height: 620 },
      paths: [{ closed: true, points: [point, { ...point, anchor: [10, 10] }] }],
      report: { pathCount: 1 }
    });

    expect(result.canvas).toEqual({ width: 620, height: 620 });
    expect(result.paths[0]?.closed).toBe(true);
    expect(result.report).toEqual({ pathCount: 1 });
  });

  it("rejects unsupported formats and empty path collections", () => {
    expect(() => validatePathJson({ format: "svg", canvas: { width: 10, height: 10 }, paths: [] }))
      .toThrow("不是受支持");
    expect(() => validatePathJson({
      format: "photoshop-path-json",
      canvas: { width: 10, height: 10 },
      paths: []
    })).toThrow("没有可编辑路径");
  });

  it("rejects non-finite and unsafe coordinates", () => {
    expect(() => validatePathJson({
      format: "photoshop-path-json",
      canvas: { width: 10, height: 10 },
      paths: [{ closed: true, points: [point, { ...point, anchor: [Number.NaN, 1] }] }]
    })).toThrow("非法坐标");

    expect(() => validatePathJson({
      format: "photoshop-path-json",
      canvas: { width: 10, height: 10 },
      paths: [{ closed: true, points: [point, { ...point, anchor: [20_000, 1] }] }]
    })).toThrow("超过坐标安全范围");
  });

  it("removes workflow padding from the canvas and every path coordinate", () => {
    const padded = validatePathJson({
      format: "photoshop-path-json",
      canvas: { width: 140, height: 90 },
      paths: [{
        closed: true,
        points: [
          {
            anchor: [20, 20],
            leftDirection: [19, 20],
            rightDirection: [21, 20]
          },
          {
            anchor: [120, 70],
            leftDirection: [119, 70],
            rightDirection: [121, 70]
          }
        ]
      }]
    });

    const result = removeCenterlineCanvasPadding(padded, 20);

    expect(result.canvas).toEqual({ width: 100, height: 50 });
    expect(result.paths[0]?.points).toEqual([
      {
        anchor: [0, 0],
        leftDirection: [-1, 0],
        rightDirection: [1, 0],
        kind: undefined
      },
      {
        anchor: [100, 50],
        leftDirection: [99, 50],
        rightDirection: [101, 50],
        kind: undefined
      }
    ]);
  });
});
