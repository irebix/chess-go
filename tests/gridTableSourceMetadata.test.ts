import { describe, expect, it } from "vitest";
import {
  GRID_TABLE_SOURCE_SCHEMA,
  GRID_TABLE_SOURCE_VERSION,
  parseGridTableSourceMetadata,
  serializeGridTableSourceMetadata,
  type GridTableSourceMetadata
} from "../src/grid/GridTableSourceMetadata";

function metadata(): GridTableSourceMetadata {
  return {
    schema: GRID_TABLE_SOURCE_SCHEMA,
    version: GRID_TABLE_SOURCE_VERSION,
    workbookName: "排期.xlsx",
    sheetName: "越南",
    volumeNumber: 1,
    volumeCount: 2,
    chains: [{
      chainId: "越南!A1:A9",
      label: "清洁工具",
      sourceCell: "A1",
      row: 0,
      groupLayerId: 101,
      items: [
        {
          assetCode: "c_cleaning1",
          name: "清洁布",
          sourceOrder: 0,
          column: 0,
          imageLayerId: 201
        },
        {
          assetCode: "c_cleaning2",
          sourceOrder: 1,
          column: 1
        }
      ]
    }]
  };
}

describe("grid table-source metadata", () => {
  it("round-trips stable chain, row, item and layer identities", () => {
    expect(parseGridTableSourceMetadata(serializeGridTableSourceMetadata(metadata())))
      .toEqual(metadata());
  });

  it("rejects duplicate rows or columns", () => {
    const duplicateRow = metadata();
    duplicateRow.chains.push({
      ...duplicateRow.chains[0]!,
      chainId: "越南!A10:A18",
      label: "第二链",
      groupLayerId: 102
    });
    expect(() => serializeGridTableSourceMetadata(duplicateRow))
      .toThrow("无效或重复");

    const duplicateColumn = metadata();
    duplicateColumn.chains[0]!.items[1]!.column = 0;
    expect(() => serializeGridTableSourceMetadata(duplicateColumn))
      .toThrow("无效或重复");
  });

  it("ignores unrelated or damaged text", () => {
    expect(parseGridTableSourceMetadata("other")).toBeUndefined();
    expect(parseGridTableSourceMetadata("chess-go-grid-table-source-v1:bad"))
      .toBeUndefined();
  });
});
