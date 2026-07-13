import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { mapAssets } from "../src/domain/mapper";
import { discoverSheetGroups } from "../src/domain/sheetGroups";
import { XlsxReader } from "../src/infrastructure/xlsx/XlsxReader";
import { isPositionInRange, parseA1Range } from "../src/utils/a1";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const filePath = args[0];
  if (!filePath) {
    throw new Error("用法：pnpm inspect:xlsx <xlsx路径> [--sheet <工作表名>] [--cell-range <A1:B5>] [--codes <code1,code2>] [--groups] [--issue-limit <数量>]");
  }
  const requestedSheet = optionValue(args, "--sheet");
  const requestedCellRange = optionValue(args, "--cell-range");
  const cellRange = requestedCellRange ? parseA1Range(requestedCellRange) : undefined;
  const issueLimit = Number(optionValue(args, "--issue-limit") ?? 0);
  if (!Number.isInteger(issueLimit) || issueLimit < 0) throw new Error("参数 --issue-limit 必须是非负整数。");
  const requestedCodes = new Set(
    (optionValue(args, "--codes") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean)
  );
  const includeGroups = args.includes("--groups");

  const absolutePath = path.resolve(filePath);
  const [bytes, metadata] = await Promise.all([readFile(absolutePath), stat(absolutePath)]);
  const reader = await XlsxReader.open(new Uint8Array(bytes), {
    fileName: path.basename(absolutePath),
    fileSize: metadata.size,
    modifiedAt: metadata.mtime.toISOString()
  });

  const descriptors = requestedSheet
    ? reader.index.sheets.filter((descriptor) => descriptor.name === requestedSheet)
    : reader.index.sheets;
  if (requestedSheet && descriptors.length === 0) {
    throw new Error(`未找到工作表：${requestedSheet}`);
  }

  const sheets = [];
  for (const descriptor of descriptors) {
    const parsed = await reader.parseSheet(descriptor);
    const items = mapAssets(parsed);
    const groups = discoverSheetGroups(parsed, items);
    sheets.push({
      name: descriptor.name,
      state: descriptor.state,
      cells: parsed.cells.length,
      images: parsed.images.length,
      items: items.length,
      groups: groups.length,
      ...(includeGroups
        ? {
            groupDetails: groups,
            uncoveredItems: items
              .filter((item) => !groups.some((group) => item.codeRow >= group.startRow && item.codeRow <= group.endRow))
              .map((item) => ({ assetCode: item.assetCode, codeCell: item.codeCell, codeRow: item.codeRow }))
          }
        : {}),
      ready: items.filter((item) => !item.issues.some((issue) => issue.severity === "error")).length,
      missingCodes: items.filter((item) => item.issues.some((issue) => issue.code === "ASSET_CODE_MISSING")).length,
      invalidCodes: items.filter((item) => item.issues.some((issue) => issue.code === "ASSET_CODE_INVALID")).length,
      missingNumericIds: items.filter((item) => item.issues.some((issue) => issue.code === "NUMERIC_ID_MISSING")).length,
      missingImages: items.filter((item) => item.issues.some((issue) => issue.code === "IMAGE_MISSING")).length,
      ambiguousImages: items.filter((item) => item.imageCandidates.length > 1).length,
      duplicateCodes: items.filter((item) => item.issues.some((issue) => issue.code === "ASSET_CODE_DUPLICATE")).length,
      ...(cellRange
        ? {
            cellsInRange: parsed.cells
              .filter((cell) => isPositionInRange(cell, cellRange))
              .map((cell) => ({ address: cell.address, value: cell.value, rawType: cell.rawType }))
          }
        : {}),
      ...(issueLimit > 0
        ? {
            issueItems: items
              .filter((item) => item.issues.length > 0)
              .slice(0, issueLimit)
              .map((item) => ({
                assetCode: item.assetCode,
                codeCell: item.codeCell,
                numericId: item.numericId,
                name: item.name,
                issueCodes: item.issues.map((issue) => issue.code),
                imageEntries: item.imageCandidates.map((candidate) => candidate.anchor.archiveEntry)
              }))
          }
        : {}),
      ...(requestedCodes.size > 0
        ? {
            matches: items
              .filter((item) => requestedCodes.has(item.assetCode))
              .map((item) => ({
                assetCode: item.assetCode,
                codeCell: item.codeCell,
                numericId: item.numericId,
                name: item.name,
                selectedImageEntry: item.imageCandidates.find((candidate) => candidate.id === item.selectedImageId)?.anchor.archiveEntry,
                selectedImageRow: item.imageCandidates.find((candidate) => candidate.id === item.selectedImageId)?.anchor.fromRow,
                imageEntries: item.imageCandidates.map((candidate) => candidate.anchor.archiveEntry),
                imageAnchors: item.imageCandidates.map((candidate) => ({
                  row: candidate.anchor.fromRow,
                  col: candidate.anchor.fromCol,
                  type: candidate.anchor.anchorType
                }))
              }))
          }
        : {})
    });
  }

  console.log(
    JSON.stringify(
      {
        source: { fileName: reader.index.source.fileName, fileSize: reader.index.source.fileSize },
        sheetCount: reader.index.sheets.length,
        archiveEntries: reader.archive.listEntries().length,
        sheets
      },
      null,
      2
    )
  );
}

function optionValue(args: string[], option: string): string | undefined {
  const index = args.indexOf(option);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`参数 ${option} 缺少值。`);
  return value;
}

void main();
