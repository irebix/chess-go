import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { buildDiagnosticBundle } from "../src/domain/diagnosticBundle";
import type { AssetCandidate } from "../src/domain/models";

describe("buildDiagnosticBundle", () => {
  it("exports summaries, manifest and logs without image binaries", async () => {
    const item: AssetCandidate = {
      key: "越南!B38",
      assetCode: "ds_vietnam1",
      numericId: "201823",
      name: "Vietnamese Rice Crust",
      prefix: "ds",
      sheetName: "越南",
      codeCell: "B38",
      codeRow: 38,
      codeCol: 2,
      sourceGroupId: "越南!A36:A40",
      sourceOrder: 0,
      imageCandidates: [{
        id: "image1",
        anchor: {
          id: "image1",
          anchorType: "oneCell",
          fromRow: 39,
          fromCol: 2,
          relationshipId: "rId1",
          archiveEntry: "xl/drawings/media/image2108.png",
          mediaType: "png"
        },
        relativeRowOffset: 1,
        relativeColOffset: 0,
        thumbnailState: "ready"
      }],
      selectedImageId: "image1",
      issues: [],
      selected: true
    };
    const bytes = await buildDiagnosticBundle({
      pluginVersion: "0.2.0",
      phase: "reviewing",
      message: "ready",
      logs: [{ timestamp: "2026-07-12T00:00:00.000Z", level: "info", event: "sheet.parse.completed" }],
      workbook: {
        sourceName: "sample.xlsx",
        sourceSize: 123,
        sourceModifiedAt: "2026-07-11T00:00:00.000Z",
        sheetCount: 2,
        zipEntryCount: 10
      },
      sheetName: "越南",
      selectedGroups: [],
      items: [item]
    }, "2026-07-12T01:00:00.000Z");

    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files).sort();
    expect(names).toEqual([
      "README.txt",
      "diagnostic-summary.json",
      "logs.json",
      "parsing-manifest.json"
    ]);
    expect(names.some((name) => /\.(png|jpe?g|xlsx)$/i.test(name))).toBe(false);
    const summary = JSON.parse(await zip.file("diagnostic-summary.json")!.async("string"));
    expect(summary.selection).toMatchObject({ items: 1, selectedItems: 1, errors: 0, warnings: 0 });
    const manifest = JSON.parse(await zip.file("parsing-manifest.json")!.async("string"));
    expect(manifest.items[0].imageCandidates[0].archiveEntry).toBe("xl/drawings/media/image2108.png");
  });

  it("can export logs before a workbook is available", async () => {
    const bytes = await buildDiagnosticBundle({
      pluginVersion: "0.2.0",
      phase: "error",
      message: "import failed",
      logs: [{ timestamp: "2026-07-12T00:00:00.000Z", level: "error", event: "import failed" }],
      selectedGroups: [],
      items: []
    });
    const zip = await JSZip.loadAsync(bytes);
    expect(zip.file("parsing-manifest.json")).toBeNull();
    expect(zip.file("logs.json")).not.toBeNull();
  });
});
