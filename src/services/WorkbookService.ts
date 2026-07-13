import type { AssetCandidate, ParsedSheet, SheetDescriptor, SheetGroup } from "../domain/models";
import { mapAssets } from "../domain/mapper";
import { discoverSheetGroups } from "../domain/sheetGroups";
import { selectXlsxFile } from "../infrastructure/filesystem/uxpFiles";
import { readXlsxFile } from "../infrastructure/filesystem/uxpFiles";
import { XlsxReader } from "../infrastructure/xlsx/XlsxReader";
import { storage } from "uxp";

export interface ImportedWorkbook {
  reader: XlsxReader;
  sourceFile: storage.File;
  sourceName: string;
  sourceSize?: number;
  sourceModifiedAt?: string;
}

export interface ParsedWorkbookSheetResult {
  parsedSheet: ParsedSheet;
  items: AssetCandidate[];
  groups: SheetGroup[];
}

export async function importWorkbook(): Promise<ImportedWorkbook> {
  const source = await selectXlsxFile();
  return openImportedWorkbook(source);
}

export async function importWorkbookFromFile(file: storage.File): Promise<ImportedWorkbook> {
  return openImportedWorkbook(await readXlsxFile(file));
}

async function openImportedWorkbook(source: Awaited<ReturnType<typeof readXlsxFile>>): Promise<ImportedWorkbook> {
  const reader = await XlsxReader.open(source.bytes, {
    fileName: source.name,
    fileSize: source.size,
    modifiedAt: source.modifiedAt
  });
  return {
    reader,
    sourceFile: source.file,
    sourceName: source.name,
    sourceSize: source.size,
    sourceModifiedAt: source.modifiedAt
  };
}

export async function parseWorkbookSheet(
  workbook: ImportedWorkbook,
  descriptor: SheetDescriptor
): Promise<ParsedWorkbookSheetResult> {
  const parsedSheet = await workbook.reader.parseSheet(descriptor);
  const items = mapAssets(parsedSheet);
  return { parsedSheet, items, groups: discoverSheetGroups(parsedSheet, items) };
}

export async function imageDataUri(workbook: ImportedWorkbook, archiveEntry: string): Promise<string> {
  const lower = archiveEntry.toLowerCase();
  const mime = lower.endsWith(".png")
    ? "image/png"
    : lower.endsWith(".jpg") || lower.endsWith(".jpeg")
      ? "image/jpeg"
      : undefined;
  if (!mime) throw new Error(`不支持预览该图片格式：${archiveEntry}`);
  const bytes = await workbook.reader.archive.readBinary(archiveEntry);
  return `data:${mime};base64,${uint8ToBase64(bytes)}`;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
