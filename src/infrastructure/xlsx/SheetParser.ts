import type { CellRecord, MergedCellRange } from "../../domain/models";
import { parseA1Address, parseA1Range, toA1Address } from "../../utils/a1";
import { asArray, attribute, child, collectTagText, isRecord, parseXml, textValue } from "./xml";

export interface ParsedWorksheetXml {
  cells: CellRecord[];
  drawingRelationshipIds: string[];
  mergedCells: MergedCellRange[];
}

export function parseWorksheet(xml: string, sharedStrings: string[]): ParsedWorksheetXml {
  const document = parseXml(xml);
  const worksheet = child(document, "worksheet");
  const rowNodes = asArray(child(child(worksheet, "sheetData"), "row"));
  const cells: CellRecord[] = [];

  for (const rowNode of rowNodes) {
    if (!isRecord(rowNode)) continue;
    const rowNumber = Number(attribute(rowNode, "r") ?? 0);
    const cellNodes = asArray(child(rowNode, "c"));
    let inferredColumn = 0;
    for (const cellNode of cellNodes) {
      if (!isRecord(cellNode)) continue;
      const rawAddress = attribute(cellNode, "r");
      const position = rawAddress
        ? parseA1Address(rawAddress)
        : { row: rowNumber, col: inferredColumn + 1 };
      inferredColumn = position.col;
      const rawType = attribute(cellNode, "t");
      const value = parseCellValue(cellNode, rawType, sharedStrings);
      cells.push({
        address: rawAddress ?? toA1Address(position.row, position.col),
        row: position.row,
        col: position.col,
        value,
        rawType
      });
    }
  }

  const drawingRelationshipIds = asArray(child(worksheet, "drawing"))
    .map((node) => attribute(node, "id"))
    .filter((value): value is string => Boolean(value));
  const mergedCells = asArray(child(child(worksheet, "mergeCells"), "mergeCell")).flatMap((node) => {
    const ref = attribute(node, "ref");
    if (!ref) return [];
    const range = parseA1Range(ref);
    return [
      {
        ref,
        startRow: range.start.row,
        startCol: range.start.col,
        endRow: range.end.row,
        endCol: range.end.col
      } satisfies MergedCellRange
    ];
  });
  return { cells, drawingRelationshipIds, mergedCells };
}

function parseCellValue(cellNode: Record<string, unknown>, rawType: string | undefined, sharedStrings: string[]) {
  if (rawType === "inlineStr") return collectTagText(child(cellNode, "is"), "t");
  const rawValue = textValue(child(cellNode, "v"));
  if (rawType === "s") {
    const index = Number(rawValue);
    return Number.isInteger(index) ? sharedStrings[index] ?? "" : "";
  }
  if (rawType === "b") return rawValue === "1";
  if (rawType === "str") return rawValue;
  return rawValue || null;
}
