import { describe, expect, it } from "vitest";
import { applyScopedTaskValidation, mapAssets, selectImageCandidate } from "../src/domain/mapper";
import type { CellRecord, ImageAnchor, ParsedSheet } from "../src/domain/models";

function parsed(cells: CellRecord[], images: ImageAnchor[]): ParsedSheet {
  return {
    descriptor: {
      name: "需求",
      sheetId: "1",
      relationshipId: "rId1",
      xmlEntry: "xl/worksheets/sheet1.xml",
      state: "visible",
      order: 0
    },
    cells,
    images,
    mergedCells: []
  };
}

function cell(address: string, row: number, col: number, value: string): CellRecord {
  return { address, row, col, value };
}

function image(id: string, row: number, col: number, mediaType: ImageAnchor["mediaType"] = "png"): ImageAnchor {
  return {
    id,
    anchorType: "oneCell",
    fromRow: row,
    fromCol: col,
    relationshipId: `rel-${id}`,
    archiveEntry: `xl/drawings/media/${id}.${mediaType === "jpeg" ? "jpg" : mediaType === "png" ? "png" : "webp"}`,
    mediaType
  };
}

describe("asset mapper", () => {
  it("maps exact offsets while applying the A1 range only to the code cell", () => {
    const result = mapAssets(
      parsed(
        [
          cell("B1", 1, 2, "1001"),
          cell("B2", 2, 2, "示例菜品"),
          cell("B3", 3, 2, "ds_test1"),
          cell("C3", 3, 3, "ds_outside")
        ],
        [image("image1", 4, 2)]
      ),
      "B3:B3"
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      assetCode: "ds_test1",
      numericId: "1001",
      name: "示例菜品",
      codeCell: "B3",
      numericIdCell: "B1",
      nameCell: "B2",
      selectedImageId: "image1",
      selected: true
    });
    expect(result[0]?.imageCandidates[0]).toMatchObject({
      relativeRowOffset: 1,
      relativeColOffset: 0,
      thumbnailState: "notLoaded"
    });
  });

  it("treats English tokens as names when they occupy the name row", () => {
    const result = mapAssets(
      parsed(
        [
          cell("B1", 1, 2, "1001"),
          cell("B2", 2, 2, "Burger2"),
          cell("B3", 3, 2, "ds_burger"),
          cell("C1", 1, 3, "1002"),
          cell("C2", 2, 3, "Chef_Salad"),
          cell("C3", 3, 3, "ds_salad")
        ],
        [image("image1", 4, 2), image("image2", 4, 3)]
      )
    );

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({ assetCode: "ds_burger", name: "Burger2", nameCell: "B2" });
    expect(result[1]).toMatchObject({ assetCode: "ds_salad", name: "Chef_Salad", nameCell: "C2" });
  });

  it("supports an extra localized-name row before the code", () => {
    const sheet = parsed(
      [
        cell("B1", 1, 2, "1001"),
        cell("B2", 2, 2, "Brazilian Lime"),
        cell("B3", 3, 2, "巴西酸橙"),
        cell("B4", 4, 2, "c_brazil_lime")
      ],
      [image("image1", 5, 2)]
    );
    const result = mapAssets(sheet);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ assetCode: "c_brazil_lime", name: "巴西酸橙", codeCell: "B4" });
    expect(result[0]?.issues.map((issue) => issue.code)).not.toContain("ASSET_CODE_INVALID");
    expect(mapAssets(sheet, "B3:B3")).toHaveLength(0);
    expect(mapAssets(sheet, "B4:B4")).toHaveLength(1);
  });

  it("finds an image on the second candidate row", () => {
    const result = mapAssets(
      parsed(
        [cell("B1", 1, 2, "1001"), cell("B2", 2, 2, "名称"), cell("B3", 3, 2, "ds_test1")],
        [image("image2", 5, 2)]
      )
    );
    expect(result[0]?.imageCandidates[0]?.relativeRowOffset).toBe(2);
    expect(result[0]?.selectedImageId).toBe("image2");
    const cleared = selectImageCandidate(result[0]!, undefined);
    expect(cleared.selected).toBe(false);
    expect(cleared.issues.map((issue) => issue.code)).toContain("IMAGE_SELECTION_MISSING");
  });

  it("keeps a missing name as a non-blocking warning", () => {
    const [item] = mapAssets(
      parsed(
        [cell("B1", 1, 2, "1001"), cell("B3", 3, 2, "ds_test1")],
        [image("image1", 4, 2)]
      )
    );

    expect(item?.issues.map((issue) => issue.code)).toContain("NAME_MISSING");
    expect(item?.selected).toBe(true);
  });

  it("keeps a missing associated image as a non-blocking warning", () => {
    const [item] = mapAssets(
      parsed(
        [cell("B1", 1, 2, "1001"), cell("B2", 2, 2, "名称"), cell("B3", 3, 2, "ds_test1")],
        []
      )
    );

    expect(item?.issues).toContainEqual(expect.objectContaining({
      code: "IMAGE_MISSING",
      severity: "warning"
    }));
    expect(item?.selectedImageId).toBeUndefined();
    expect(item?.selected).toBe(true);
  });

  it("defaults multiple images to the lower project row and allows an explicit switch", () => {
    const [item] = mapAssets(
      parsed(
        [cell("B1", 1, 2, "1001"), cell("B2", 2, 2, "名称"), cell("B3", 3, 2, "ds_test1")],
        [image("image1", 4, 2), image("image2", 5, 2)]
      )
    );
    expect(item?.selectedImageId).toBe("image2");
    expect(item?.selected).toBe(true);
    expect(item?.issues.map((issue) => issue.code)).not.toContain("IMAGE_AMBIGUOUS");

    const selected = selectImageCandidate(item!, "image1");
    expect(selected.selected).toBe(true);
    expect(selected.selectedImageId).toBe("image1");

    const cleared = selectImageCandidate(item!, undefined);
    expect(cleared.selected).toBe(false);
    expect(cleared.issues.map((issue) => issue.code)).toContain("IMAGE_SELECTION_MISSING");

    const invalid = selectImageCandidate(item!, "missing-image");
    expect(invalid.selected).toBe(false);
    expect(invalid.issues.map((issue) => issue.code)).toContain("IMAGE_SELECTION_INVALID");
  });

  it("warns for a missing numericId and blocks duplicate assetCode values", () => {
    const result = mapAssets(
      parsed(
        [
          cell("B2", 2, 2, "名称一"),
          cell("B3", 3, 2, "ds_same"),
          cell("C1", 1, 3, "2002"),
          cell("C2", 2, 3, "名称二"),
          cell("C3", 3, 3, "ds_same")
        ],
        [image("image1", 4, 2), image("image2", 4, 3)]
      )
    );

    expect(result[0]?.issues.map((issue) => issue.code)).toContain("NUMERIC_ID_MISSING");
    expect(result.every((item) => item.issues.some((issue) => issue.code === "ASSET_CODE_DUPLICATE"))).toBe(true);
    expect(result.every((item) => item.selected === false)).toBe(true);
  });

  it("groups by code row, orders by row/column and warns about duplicate numericId", () => {
    const result = mapAssets(
      parsed(
        [
          cell("B8", 8, 2, "ds_third"),
          cell("C3", 3, 3, "c_second"),
          cell("B3", 3, 2, "ds_first"),
          cell("B1", 1, 2, "1001"),
          cell("C1", 1, 3, "1001"),
          cell("B2", 2, 2, "名称一"),
          cell("C2", 2, 3, "名称二"),
          cell("B6", 6, 2, "1003"),
          cell("B7", 7, 2, "名称三")
        ],
        [image("image1", 4, 2), image("image2", 4, 3), image("image3", 9, 2)]
      )
    );

    expect(result.map((item) => item.assetCode)).toEqual(["ds_first", "c_second", "ds_third"]);
    expect(result[0]?.sourceGroupId).toBe(result[1]?.sourceGroupId);
    expect(result[2]?.sourceGroupId).not.toBe(result[0]?.sourceGroupId);
    expect(result.slice(0, 2).every((item) => item.issues.some((issue) => issue.code === "NUMERIC_ID_DUPLICATE"))).toBe(
      true
    );
  });

  it("blocks an unsupported selected media type", () => {
    const [item] = mapAssets(
      parsed(
        [cell("B1", 1, 2, "1001"), cell("B2", 2, 2, "名称"), cell("B3", 3, 2, "ds_test1")],
        [image("image1", 4, 2, "other")]
      )
    );
    expect(item?.issues.map((issue) => issue.code)).toContain("UNSUPPORTED_MEDIA_TYPE");
    expect(item?.selected).toBe(false);
  });

  it("surfaces structured records with invalid or missing assetCode values", () => {
    const result = mapAssets(
      parsed(
        [
          cell("B1", 1, 2, "1001"),
          cell("B2", 2, 2, "Burger"),
          cell("B3", 3, 2, "ds-bad"),
          cell("C1", 1, 3, "1002"),
          cell("C2", 2, 3, "Soup")
        ],
        [image("image1", 4, 2), image("image2", 4, 3)]
      )
    );

    expect(result.map((item) => item.codeCell)).toEqual(["B3", "C3"]);
    expect(result[0]?.issues.map((issue) => issue.code)).toContain("ASSET_CODE_INVALID");
    expect(result[1]?.issues.map((issue) => issue.code)).toContain("ASSET_CODE_MISSING");
    expect(result[1]?.issues.map((issue) => issue.code)).not.toContain("ASSET_CODE_DUPLICATE");
    expect(result[0]?.selected).toBe(false);
    expect(result[1]?.selected).toBe(true);
  });

  it("locates invalid and missing codes after an extra localized-name row", () => {
    const result = mapAssets(
      parsed(
        [
          cell("B1", 1, 2, "1001"),
          cell("B2", 2, 2, "Brazilian Lime"),
          cell("B3", 3, 2, "巴西酸橙"),
          cell("B4", 4, 2, "c-bad"),
          cell("C1", 1, 3, "1002"),
          cell("C2", 2, 3, "Brazilian Soup"),
          cell("C3", 3, 3, "巴西汤")
        ],
        [image("image1", 5, 2), image("image2", 5, 3)]
      )
    );

    expect(result.map((item) => item.codeCell)).toEqual(["B4", "C4"]);
    expect(result[0]).toMatchObject({ assetCode: "c-bad", name: "巴西酸橙", nameCell: "B3" });
    expect(result[0]?.issues.map((issue) => issue.code)).toContain("ASSET_CODE_INVALID");
    expect(result[1]).toMatchObject({ assetCode: "", name: "巴西汤", nameCell: "C3" });
    expect(result[1]?.issues.map((issue) => issue.code)).toContain("ASSET_CODE_MISSING");
  });

  it("recomputes duplicate issues only within the selected task scope", () => {
    const duplicates = mapAssets(
      parsed(
        [
          cell("B1", 1, 2, "1001"),
          cell("B2", 2, 2, "名称一"),
          cell("B3", 3, 2, "ds_same"),
          cell("B6", 6, 2, "1002"),
          cell("B7", 7, 2, "名称二"),
          cell("B8", 8, 2, "ds_same")
        ],
        [image("image1", 4, 2), image("image2", 9, 2)]
      )
    );

    expect(applyScopedTaskValidation(duplicates).every((item) => item.issues.some((issue) => issue.code === "ASSET_CODE_DUPLICATE"))).toBe(true);
    const singleGroupScope = applyScopedTaskValidation([duplicates[0]!]);
    expect(singleGroupScope[0]?.issues.map((issue) => issue.code)).not.toContain("ASSET_CODE_DUPLICATE");
  });
});
