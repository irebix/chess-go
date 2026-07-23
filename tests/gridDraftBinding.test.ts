import { describe, expect, it } from "vitest";
import {
  gridDraftChainToken,
  gridDraftExpectedLayerNames,
  gridDraftGroupName,
  gridDraftGroupRow,
  gridDraftLayerName
} from "../src/grid/GridDraftBinding";

describe("standard grid AI draft binding", () => {
  it("builds stable workflow-independent chain tokens", () => {
    expect(gridDraftChainToken("Sheet1!A2:A9")).toBe(gridDraftChainToken("Sheet1!A2:A9"));
    expect(gridDraftChainToken("Sheet1!A2:A9")).not.toBe(gridDraftChainToken("Sheet1!A10:A17"));
  });

  it("keeps the chain position in every persistent Photoshop layer name", () => {
    expect(gridDraftLayerName("Sheet1!A2:A9", 2, "c_glove3"))
      .toMatch(/^AI初稿 c_glove3｜[0-9a-f]{8}-03$/);
  });

  it("maps exact persistent layer names back to chain indexes", () => {
    const names = gridDraftExpectedLayerNames("Sheet1!A2:A9", [
      { chainIndex: 0, assetCode: "c_glove1" },
      { chainIndex: 2, assetCode: "c_glove3" }
    ]);
    expect(Array.from(names.values())).toEqual([0, 2]);
  });

  it("stores the persistent chain row in a readable Photoshop group name", () => {
    const name = gridDraftGroupName("Sheet1!A2:A9", "手套", 3);
    expect(name).toMatch(/^AI初稿 手套｜[0-9a-f]{8}-R04$/);
    expect(gridDraftGroupRow(name, "Sheet1!A2:A9")).toBe(3);
    expect(gridDraftGroupRow(name)).toBe(3);
    expect(gridDraftGroupRow(name, "Sheet1!A10:A17")).toBeUndefined();
  });
});
