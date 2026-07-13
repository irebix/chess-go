import { describe, expect, it } from "vitest";
import { discoverSheetGroups, filterItemsByGroups } from "../src/domain/sheetGroups";
import type { AssetCandidate, ParsedSheet } from "../src/domain/models";

function item(assetCode: string, codeRow: number, sourceOrder: number): AssetCandidate {
  return {
    key: `sheet!B${codeRow}`,
    assetCode,
    prefix: "ds",
    sheetName: "sheet",
    codeCell: `B${codeRow}`,
    codeRow,
    codeCol: 2,
    sourceGroupId: `sheet!codeRow:${codeRow}`,
    sourceOrder,
    imageCandidates: [],
    issues: [],
    selected: true
  };
}

function sheet(): ParsedSheet {
  return {
    descriptor: {
      name: "sheet",
      sheetId: "1",
      relationshipId: "rId1",
      xmlEntry: "xl/worksheets/sheet1.xml",
      state: "visible",
      order: 0
    },
    cells: [
      { address: "A1", row: 1, col: 1, value: "绣切皮" },
      { address: "A5", row: 5, col: 1, value: "和果子" }
    ],
    images: [],
    mergedCells: [
      { ref: "A1:A4", startRow: 1, startCol: 1, endRow: 4, endCol: 1 },
      { ref: "A5:A16", startRow: 5, startCol: 1, endRow: 16, endCol: 1 }
    ]
  };
}

describe("sheet groups", () => {
  it("uses A-column merged ranges and includes every item row in the selected group", () => {
    const items = [item("ds_skin", 3, 0), item("ds_cake", 7, 1), item("ds_mochi", 11, 2), item("ds_soup", 15, 3)];
    const groups = discoverSheetGroups(sheet(), items);

    expect(groups).toEqual([
      {
        id: "sheet!A1:A4",
        label: "绣切皮",
        sourceCell: "A1",
        startRow: 1,
        endRow: 4,
        itemCount: 1,
        physicalSegments: [{ ref: "A1:A4", startRow: 1, endRow: 4 }],
        inferredContinuation: false
      },
      {
        id: "sheet!A5:A16",
        label: "和果子",
        sourceCell: "A5",
        startRow: 5,
        endRow: 16,
        itemCount: 3,
        physicalSegments: [{ ref: "A5:A16", startRow: 5, endRow: 16 }],
        inferredContinuation: false
      }
    ]);
    expect(filterItemsByGroups(items, [groups[1]!]).map((value) => value.assetCode)).toEqual([
      "ds_cake",
      "ds_mochi",
      "ds_soup"
    ]);
  });

  it("falls back to a single all-items group when column A has no usable labels", () => {
    const parsed = { ...sheet(), cells: [], mergedCells: [] };
    const items = [item("ds_1", 3, 0), item("ds_2", 9, 1)];
    expect(discoverSheetGroups(parsed, items)).toEqual([
      {
        id: "sheet!all",
        label: "全部已识别项目",
        sourceCell: "A1",
        startRow: 3,
        endRow: 9,
        itemCount: 2,
        physicalSegments: [],
        inferredContinuation: false
      }
    ]);
  });

  it("keeps a blank merged A-column range as an unnamed selectable group", () => {
    const parsed = sheet();
    parsed.cells[0] = { address: "A1", row: 1, col: 1, value: " " };
    const groups = discoverSheetGroups(parsed, [item("ds_blank", 3, 0), item("ds_named", 7, 1)]);

    expect(groups[0]).toMatchObject({
      id: "sheet!A1:A4",
      label: "未命名分组（A1:A4）",
      startRow: 1,
      endRow: 4,
      itemCount: 1
    });
    expect(groups[1]).toMatchObject({ label: "和果子", itemCount: 1 });
  });

  it("coalesces consecutive same-name segments into one logical group", () => {
    const parsed = sheet();
    parsed.cells = [
      { address: "A1", row: 1, col: 1, value: "京菜" },
      { address: "A5", row: 5, col: 1, value: "京 菜" },
      { address: "A9", row: 9, col: 1, value: "川菜" }
    ];
    parsed.mergedCells = [
      { ref: "A1:A4", startRow: 1, startCol: 1, endRow: 4, endCol: 1 },
      { ref: "A5:A8", startRow: 5, startCol: 1, endRow: 8, endCol: 1 },
      { ref: "A9:A12", startRow: 9, startCol: 1, endRow: 12, endCol: 1 }
    ];
    const groups = discoverSheetGroups(parsed, [item("ds_1", 3, 0), item("ds_2", 7, 1), item("ds_3", 11, 2)]);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ label: "京菜", startRow: 1, endRow: 8, itemCount: 2 });
    expect(groups[0]?.physicalSegments).toHaveLength(2);
    expect(groups[1]).toMatchObject({ label: "川菜", itemCount: 1 });
  });

  it("inherits an asset-bearing blank segment as the previous named group's continuation", () => {
    const parsed = sheet();
    parsed.cells = [
      { address: "A1", row: 1, col: 1, value: "桑巴滋味" },
      { address: "A7", row: 7, col: 1, value: "" },
      { address: "A12", row: 12, col: 1, value: "热带水果" }
    ];
    parsed.mergedCells = [
      { ref: "A1:A5", startRow: 1, startCol: 1, endRow: 5, endCol: 1 },
      { ref: "A7:A10", startRow: 7, startCol: 1, endRow: 10, endCol: 1 },
      { ref: "A12:A16", startRow: 12, startCol: 1, endRow: 16, endCol: 1 }
    ];
    const groups = discoverSheetGroups(parsed, [item("ds_1", 3, 0), item("ds_2", 8, 1), item("ds_3", 14, 2)]);

    expect(groups[0]).toMatchObject({
      label: "桑巴滋味",
      startRow: 1,
      endRow: 10,
      itemCount: 2,
      inferredContinuation: true
    });
    expect(groups[0]?.physicalSegments.map((segment) => segment.ref)).toEqual(["A1:A5", "A7:A10"]);
    expect(filterItemsByGroups([item("ds_1", 3, 0), item("ds_2", 8, 1)], [groups[0]!])).toHaveLength(2);
  });

  it("ignores horizontal merges and ordinary A-column footer cells", () => {
    const parsed = sheet();
    parsed.cells = [
      { address: "A1", row: 1, col: 1, value: "横向标题" },
      { address: "A6", row: 6, col: 1, value: "有效分组" },
      { address: "A20", row: 20, col: 1, value: "总计" }
    ];
    parsed.mergedCells = [
      { ref: "A1:C1", startRow: 1, startCol: 1, endRow: 1, endCol: 3 },
      { ref: "A6:A10", startRow: 6, startCol: 1, endRow: 10, endCol: 1 }
    ];
    const groups = discoverSheetGroups(parsed, [item("ds_grouped", 8, 0)]);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("有效分组");
  });
});
