import { describe, expect, it } from "vitest";
import { filterAndSortItems } from "../src/domain/itemView";
import type { AssetCandidate, ImageCandidate, ValidationIssue } from "../src/domain/models";

function imageCandidate(id: string, row: number): ImageCandidate {
  return {
    id,
    anchor: {
      id,
      anchorType: "oneCell",
      fromRow: row,
      fromCol: 1,
      relationshipId: `rId-${id}`,
      archiveEntry: `xl/media/${id}.png`,
      mediaType: "png"
    },
    relativeRowOffset: row - 1,
    relativeColOffset: 0,
    thumbnailState: "notLoaded"
  };
}

function item(
  assetCode: string,
  sourceOrder: number,
  options: { prefix?: string; numericId?: string; name?: string; issue?: ValidationIssue } = {}
): AssetCandidate {
  return {
    key: assetCode,
    assetCode,
    numericId: options.numericId,
    name: options.name,
    prefix: options.prefix ?? "ds",
    sheetName: "sheet",
    codeCell: `A${sourceOrder + 1}`,
    codeRow: sourceOrder + 1,
    codeCol: 1,
    sourceGroupId: `group-${sourceOrder}`,
    sourceOrder,
    imageCandidates: [],
    issues: options.issue ? [options.issue] : [],
    selected: true
  };
}

describe("item view", () => {
  it("filters by issue and prefix", () => {
    const items = [
      item("ds_1", 0, { issue: { code: "IMAGE_MISSING", severity: "error", message: "missing" } }),
      item("c_1", 1, { prefix: "c", issue: { code: "NUMERIC_ID_MISSING", severity: "warning", message: "id" } }),
      item("ds_2", 2)
    ];

    expect(filterAndSortItems(items, { filter: "imageMissing", prefix: "all", sort: "source" })).toHaveLength(1);
    expect(filterAndSortItems(items, { filter: "warning", prefix: "c", sort: "source" })[0]?.assetCode).toBe("c_1");
    expect(filterAndSortItems(items, { filter: "ready", prefix: "all", sort: "source" }).map((value) => value.assetCode)).toEqual([
      "c_1",
      "ds_2"
    ]);
  });

  it("sorts naturally and keeps source order as the tie breaker", () => {
    const items = [
      item("ds_10", 0, { numericId: "20", name: "Beta" }),
      item("ds_2", 2, { numericId: "3", name: "Alpha" }),
      item("ds_2", 1, { numericId: "3", name: "Alpha" })
    ];

    expect(filterAndSortItems(items, { filter: "all", prefix: "all", sort: "assetCode" }).map((value) => value.sourceOrder)).toEqual([
      1,
      2,
      0
    ]);
    expect(filterAndSortItems(items, { filter: "all", prefix: "all", sort: "numericId" }).map((value) => value.assetCode)).toEqual([
      "ds_2",
      "ds_2",
      "ds_10"
    ]);
    expect(filterAndSortItems(items, { filter: "all", prefix: "all", sort: "name" })[0]?.name).toBe("Alpha");
  });

  it("filters multiple image choices without requiring an ambiguity error", () => {
    const single = { ...item("ds_single", 0), imageCandidates: [imageCandidate("one", 2)] };
    const multiple = {
      ...item("ds_multiple", 1),
      imageCandidates: [imageCandidate("reference", 2), imageCandidate("project", 3)]
    };

    expect(filterAndSortItems([single, multiple], { filter: "imageAmbiguous", prefix: "all", sort: "source" }))
      .toEqual([multiple]);
  });
});
