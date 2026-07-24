import { describe, expect, it } from "vitest";
import {
  planTableGridVolumes,
  TABLE_GRID_CHAINS_PER_VOLUME,
  TABLE_GRID_ITEMS_PER_CHAIN
} from "../src/domain/tableGridPlan";
import type { AssetCandidate, SheetGroup } from "../src/domain/models";

function group(index: number, label = `链${index}`): SheetGroup {
  const startRow = index * 10 + 1;
  return {
    id: `sheet!A${startRow}:A${startRow + 8}`,
    label,
    sourceCell: `A${startRow}`,
    startRow,
    endRow: startRow + 8,
    itemCount: 1,
    physicalSegments: [{ ref: `A${startRow}:A${startRow + 8}`, startRow, endRow: startRow + 8 }],
    inferredContinuation: false
  };
}

function item(
  assetCode: string,
  codeRow: number,
  codeCol: number,
  sourceOrder: number,
  selected = true
): AssetCandidate {
  return {
    key: `sheet!${assetCode}`,
    assetCode,
    prefix: "c_",
    sheetName: "sheet",
    codeCell: `B${codeRow}`,
    codeRow,
    codeCol,
    sourceGroupId: `sheet!codeRow:${codeRow}`,
    sourceOrder,
    imageCandidates: [],
    issues: [],
    selected
  };
}

describe("table grid plan", () => {
  it("sorts chains by Excel row and items by reading order", () => {
    const first = group(0, "第一链");
    const second = group(1, "第二链");
    const plan = planTableGridVolumes(
      [second, first],
      [
        item("c_second", 12, 2, 3),
        item("c_first_b", 5, 4, 2),
        item("c_first_a", 5, 2, 1),
        item("c_unchecked", 6, 2, 4, false)
      ]
    );

    expect(plan).toHaveLength(1);
    expect(plan[0]?.chains.map((chain) => [chain.group.label, chain.row])).toEqual([
      ["第一链", 0],
      ["第二链", 1]
    ]);
    expect(plan[0]?.chains[0]?.items.map(({ item: current, column }) => [
      current.assetCode,
      column
    ])).toEqual([
      ["c_first_a", 0],
      ["c_first_b", 1]
    ]);
  });

  it("keeps chain boundaries while splitting every eight rows", () => {
    const groups = Array.from({ length: TABLE_GRID_CHAINS_PER_VOLUME + 1 }, (_, index) => group(index));
    const items = groups.map((current, index) =>
      item(`c_${index}`, current.startRow + 1, 2, index)
    );
    const plan = planTableGridVolumes(groups, items);

    expect(plan.map((volume) => volume.chains.length)).toEqual([
      TABLE_GRID_CHAINS_PER_VOLUME,
      1
    ]);
    expect(plan[0]?.chains.map((chain) => chain.row)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(plan[1]?.chains[0]?.row).toBe(0);
  });

  it("rejects a chain that cannot fit on one row", () => {
    const current = group(0, "超长链");
    const items = Array.from({ length: TABLE_GRID_ITEMS_PER_CHAIN + 1 }, (_, index) =>
      item(`c_${index}`, current.startRow + 1, index + 2, index)
    );
    expect(() => planTableGridVolumes([current], items))
      .toThrow("超过标准网格单行 12 格上限");
  });

  it("skips selected chains with no selected items and rejects an empty plan", () => {
    const current = group(0);
    expect(() => planTableGridVolumes(
      [current],
      [item("c_unchecked", current.startRow + 1, 2, 0, false)]
    )).toThrow("没有选择可生成到网格的棋子");
  });
});
