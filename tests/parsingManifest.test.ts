import { describe, expect, it } from "vitest";
import { buildParsingManifest } from "../src/domain/parsingManifest";
import type { AssetCandidate } from "../src/domain/models";

describe("parsing manifest", () => {
  it("records source cells, candidates, selections and validation summary", () => {
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
      nameCell: "B37",
      numericIdCell: "B36",
      sourceGroupId: "越南!codeRow:38",
      sourceOrder: 0,
      imageCandidates: [
        {
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
        }
      ],
      selectedImageId: "image1",
      issues: [{ code: "NUMERIC_ID_DUPLICATE", severity: "warning", message: "duplicate" }],
      selected: true
    };

    const manifest = buildParsingManifest(
      {
        workbook: { sourceName: "sample.xlsx", sourceSize: 123, sourceModifiedAt: "2026-01-01T00:00:00.000Z" },
        sheetName: "越南",
        selectedGroups: [
          {
            id: "越南!A36:A40",
            label: "越南小吃",
            sourceCell: "A36",
            startRow: 36,
            endRow: 40,
            itemCount: 1,
            physicalSegments: [{ ref: "A36:A40", startRow: 36, endRow: 40 }],
            inferredContinuation: false
          }
        ],
        items: [item]
      },
      "2026-01-02T00:00:00.000Z"
    );

    expect(manifest.summary).toEqual({ items: 1, ready: 1, errors: 0, warnings: 1 });
    expect(manifest.source.selectedGroups[0]).toMatchObject({ label: "越南小吃", startRow: 36, endRow: 40 });
    expect(manifest.items[0]).toMatchObject({
      assetCode: "ds_vietnam1",
      codeCell: "B38",
      selectedImageId: "image1",
      imageCandidates: [
        {
          archiveEntry: "xl/drawings/media/image2108.png",
          anchorCell: "B39",
          anchorType: "oneCell"
        }
      ]
    });
  });
});
