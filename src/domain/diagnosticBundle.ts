import JSZip from "jszip";
import type { AssetCandidate, SheetGroup } from "./models";
import { buildParsingManifest } from "./parsingManifest";
import type { LogEvent } from "../utils/logging";

export interface DiagnosticBundleInput {
  pluginVersion: string;
  phase: string;
  message: string;
  logs: LogEvent[];
  workbook?: {
    sourceName: string;
    sourceSize?: number;
    sourceModifiedAt?: string;
    sheetCount: number;
    zipEntryCount: number;
  };
  sheetName?: string;
  selectedGroups: SheetGroup[];
  items: AssetCandidate[];
}

export async function buildDiagnosticBundle(
  input: DiagnosticBundleInput,
  exportedAt = new Date().toISOString()
): Promise<Uint8Array> {
  const zip = new JSZip();
  const errorCount = input.items.reduce(
    (count, item) => count + item.issues.filter((issue) => issue.severity === "error").length,
    0
  );
  const warningCount = input.items.reduce(
    (count, item) => count + item.issues.filter((issue) => issue.severity === "warning").length,
    0
  );

  zip.file("diagnostic-summary.json", JSON.stringify({
    schemaVersion: "1.0",
    pluginVersion: input.pluginVersion,
    exportedAt,
    phase: input.phase,
    message: input.message,
    source: input.workbook,
    selection: {
      sheetName: input.sheetName,
      selectedGroups: input.selectedGroups.map((group) => ({
        id: group.id,
        label: group.label,
        startRow: group.startRow,
        endRow: group.endRow,
        itemCount: group.itemCount
      })),
      items: input.items.length,
      selectedItems: input.items.filter((item) => item.selected).length,
      errors: errorCount,
      warnings: warningCount
    }
  }, null, 2));

  zip.file("logs.json", JSON.stringify(input.logs, null, 2));
  zip.file(
    "README.txt",
    "棋子go 诊断包\n\n仅包含解析摘要、来源地址、Manifest 与结构化日志；不包含 XLSX 原文件或任何图片二进制。\n"
  );

  if (input.workbook && input.sheetName) {
    zip.file("parsing-manifest.json", JSON.stringify(buildParsingManifest({
      workbook: input.workbook,
      sheetName: input.sheetName,
      selectedGroups: input.selectedGroups,
      items: input.items
    }, exportedAt), null, 2));
  }

  return zip.generateAsync({
    type: "uint8array",
    compression: "DEFLATE",
    compressionOptions: { level: 6 }
  });
}
