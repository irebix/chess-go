import type { AssetCandidate, SheetGroup } from "./models";
import { toA1Address } from "../utils/a1";
import { PLUGIN_VERSION } from "../pluginMetadata";

export interface ParsingManifestInput {
  workbook: {
    sourceName: string;
    sourceSize?: number;
    sourceModifiedAt?: string;
  };
  sheetName: string;
  selectedGroups: SheetGroup[];
  items: AssetCandidate[];
}

export function buildParsingManifest(input: ParsingManifestInput, exportedAt = new Date().toISOString()) {
  return {
    schemaVersion: "1.0",
    pluginVersion: PLUGIN_VERSION,
    exportedAt,
    source: {
      fileName: input.workbook.sourceName,
      fileSize: input.workbook.sourceSize,
      modifiedAt: input.workbook.sourceModifiedAt,
      sheetName: input.sheetName,
      selectedGroups: input.selectedGroups
    },
    summary: {
      items: input.items.length,
      ready: input.items.filter((item) => !item.issues.some((issue) => issue.severity === "error")).length,
      errors: input.items.reduce(
        (count, item) => count + item.issues.filter((issue) => issue.severity === "error").length,
        0
      ),
      warnings: input.items.reduce(
        (count, item) => count + item.issues.filter((issue) => issue.severity === "warning").length,
        0
      )
    },
    items: input.items.map((item) => ({
      key: item.key,
      assetCode: item.assetCode,
      numericId: item.numericId,
      name: item.name,
      prefix: item.prefix,
      sheetName: item.sheetName,
      codeCell: item.codeCell,
      nameCell: item.nameCell,
      numericIdCell: item.numericIdCell,
      sourceGroupId: item.sourceGroupId,
      sourceOrder: item.sourceOrder,
      selected: item.selected,
      selectedImageId: item.selectedImageId,
      imageCandidates: item.imageCandidates.map((candidate) => ({
        id: candidate.id,
        archiveEntry: candidate.anchor.archiveEntry,
        mediaType: candidate.anchor.mediaType,
        anchorType: candidate.anchor.anchorType,
        anchorCell: toA1Address(candidate.anchor.fromRow, candidate.anchor.fromCol),
        fromRow: candidate.anchor.fromRow,
        fromCol: candidate.anchor.fromCol,
        toRow: candidate.anchor.toRow,
        toCol: candidate.anchor.toCol,
        relativeRowOffset: candidate.relativeRowOffset,
        relativeColOffset: candidate.relativeColOffset
      })),
      issues: item.issues
    }))
  };
}
