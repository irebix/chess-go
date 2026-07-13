import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { mapAssets } from "../src/domain/mapper";
import { XlsxReader } from "../src/infrastructure/xlsx/XlsxReader";

async function openFixture(name: string): Promise<XlsxReader> {
  const url = new URL(`../fixtures/${name}`, import.meta.url);
  const bytes = await readFile(fileURLToPath(url));
  return XlsxReader.open(new Uint8Array(bytes), { fileName: name, fileSize: bytes.byteLength });
}

async function modifiedTencentFixture(change: (zip: JSZip) => void): Promise<XlsxReader> {
  const url = new URL("../fixtures/tencent-export-minimal.xlsx", import.meta.url);
  const zip = await JSZip.loadAsync(await readFile(fileURLToPath(url)));
  change(zip);
  const bytes = await zip.generateAsync({ type: "uint8array" });
  return XlsxReader.open(bytes, { fileName: "modified-tencent.xlsx", fileSize: bytes.byteLength });
}

describe("XlsxReader", () => {
  it("parses workbook, shared strings, cells and Tencent image anchors", async () => {
    const reader = await openFixture("tencent-export-minimal.xlsx");
    expect(reader.index.sheets.map((sheet) => sheet.name)).toEqual(["Sample需求"]);
    expect(reader.index.sheets[0]).toMatchObject({
      relationshipId: "rId1",
      xmlEntry: "xl/worksheets/sheet1.xml",
      state: "visible",
      order: 0
    });
    expect(reader.index.sharedStringsEntry).toBe("xl/sharedStrings.xml");
    expect(reader.archive.has("xl/styles.xml")).toBe(false);

    const parsed = await reader.parseSheet(reader.index.sheets[0]!);
    expect(parsed.mergedCells).toEqual([]);
    expect(parsed.cells.find((cell) => cell.address === "A2")?.value).toBe("示例菜品一");
    expect(parsed.cells.find((cell) => cell.address === "B2")?.value).toBe("示例 Dish Two");
    expect(parsed.cells.find((cell) => cell.address === "C2")?.value).toBe("  示例三  ");
    expect(parsed.images).toHaveLength(4);
    expect(parsed.images.map((image) => image.archiveEntry)).toContain("xl/drawings/media/image1.png");
    expect(parsed.images[0]).toMatchObject({
      anchorType: "oneCell",
      fromRow: 4,
      fromCol: 1,
      widthEmu: 609600,
      heightEmu: 609600,
      archiveEntry: "xl/drawings/media/image1.png"
    });
    expect(parsed.images[3]).toMatchObject({
      anchorType: "twoCell",
      fromRow: 4,
      fromCol: 3,
      toRow: 5,
      toCol: 4,
      archiveEntry: "xl/drawings/media/image4.png"
    });

    const items = mapAssets(parsed);
    expect(items.map((item) => item.assetCode)).toEqual(["ds_test1", "ds_test2", "ds_test3"]);
    expect(items[0]?.imageCandidates).toHaveLength(2);
    expect(items[0]?.selectedImageId).toBe(items[0]?.imageCandidates[1]?.id);
    expect(items[0]?.issues.map((issue) => issue.code)).not.toContain("IMAGE_AMBIGUOUS");
    expect(items[0]?.selected).toBe(true);
    expect(items[1]?.selected).toBe(true);
    expect(items[2]?.imageCandidates[0]?.anchor.anchorType).toBe("twoCell");
  });

  it("supports the standard xl/media relationship target", async () => {
    const reader = await openFixture("standard-media-minimal.xlsx");
    const parsed = await reader.parseSheet(reader.index.sheets[0]!);
    expect(parsed.images.some((image) => image.archiveEntry === "xl/media/image1.png")).toBe(true);
  });

  it("ignores a malformed styles.xml entry", async () => {
    const reader = await modifiedTencentFixture((zip) => {
      zip.file("xl/styles.xml", "<styleSheet><broken>");
    });

    const parsed = await reader.parseSheet(reader.index.sheets[0]!);
    expect(mapAssets(parsed).map((item) => item.assetCode)).toEqual(["ds_test1", "ds_test2", "ds_test3"]);
  });

  it("reports a missing drawing relationships entry", async () => {
    const reader = await modifiedTencentFixture((zip) => {
      zip.remove("xl/drawings/_rels/drawing1.xml.rels");
    });

    await expect(reader.parseSheet(reader.index.sheets[0]!)).rejects.toThrow(
      "drawing xl/drawings/drawing1.xml 缺少 relationships"
    );
  });
});
