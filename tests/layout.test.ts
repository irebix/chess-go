import { describe, expect, it } from "vitest";
import { layoutItems, splitIntoVolumes } from "../src/domain/layout";
import { DEFAULT_TEMPLATE, type AssetCandidate } from "../src/domain/models";

function item(index: number, group: string): AssetCandidate {
  return {
    key: String(index),
    assetCode: `ds_${index}`,
    prefix: "ds",
    sheetName: "sheet",
    codeCell: `A${index + 1}`,
    codeRow: index + 1,
    codeCol: 1,
    sourceGroupId: group,
    sourceOrder: index,
    imageCandidates: [],
    issues: [],
    selected: true
  };
}

describe("layout", () => {
  it("reproduces the 43-item grouped five-row layout", () => {
    const items = [
      ...Array.from({ length: 14 }, (_, index) => item(index, "group-1")),
      ...Array.from({ length: 29 }, (_, index) => item(index + 14, "group-2"))
    ];
    const result = layoutItems(items, DEFAULT_TEMPLATE);
    expect(result.rows).toBe(5);
    expect(result.width).toBe(2380);
    expect(result.height).toBe(1140);
    expect(result.placements[14]).toMatchObject({ row: 2, col: 0 });
    expect(result.placements[9]?.rect.left).toBe(2232);
  });

  it("supports compact layout", () => {
    const template = {
      ...DEFAULT_TEMPLATE,
      layout: { ...DEFAULT_TEMPLATE.layout, preserveSourceGroups: false }
    };
    const items = [
      ...Array.from({ length: 14 }, (_, index) => item(index, "group-1")),
      ...Array.from({ length: 29 }, (_, index) => item(index + 14, "group-2"))
    ];
    expect(layoutItems(items, template).placements[14]).toMatchObject({ row: 1, col: 4 });
  });

  it("splits at group boundaries", () => {
    const items = [
      ...Array.from({ length: 80 }, (_, index) => item(index, "group-1")),
      ...Array.from({ length: 40 }, (_, index) => item(index + 80, "group-2"))
    ];
    expect(splitIntoVolumes(items, 100).map((volume) => volume.length)).toEqual([80, 40]);
  });
});
