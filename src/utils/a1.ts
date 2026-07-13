export interface CellPosition {
  row: number;
  col: number;
}

export interface A1Range {
  start: CellPosition;
  end: CellPosition;
}

const MAX_EXCEL_ROW = 1_048_576;
const MAX_EXCEL_COLUMN = 16_384;

export function parseA1Address(address: string): CellPosition {
  const match = /^\$?([A-Za-z]+)\$?(\d+)$/.exec(address.trim());
  if (!match?.[1] || !match[2]) {
    throw new Error(`无效的 A1 地址：${address}`);
  }
  const row = Number(match[2]);
  const col = columnLettersToNumber(match[1]);
  if (!Number.isSafeInteger(row) || row < 1 || row > MAX_EXCEL_ROW || col > MAX_EXCEL_COLUMN) {
    throw new Error(`无效的 A1 地址：${address}`);
  }
  return { row, col };
}

export function parseA1Range(input: string): A1Range {
  const parts = input.trim().split(":");
  if (!parts[0]) throw new Error("范围不能为空。");
  if (parts.length > 2) throw new Error(`无效的 A1 范围：${input}`);
  if (parts.length === 2 && !parts[1]) throw new Error(`无效的 A1 范围：${input}`);
  const first = parseA1Address(parts[0]);
  const second = parts[1] ? parseA1Address(parts[1]) : first;
  return {
    start: { row: Math.min(first.row, second.row), col: Math.min(first.col, second.col) },
    end: { row: Math.max(first.row, second.row), col: Math.max(first.col, second.col) }
  };
}

export function isPositionInRange(position: CellPosition, range?: A1Range): boolean {
  if (!range) return true;
  return (
    position.row >= range.start.row &&
    position.row <= range.end.row &&
    position.col >= range.start.col &&
    position.col <= range.end.col
  );
}

export function columnLettersToNumber(letters: string): number {
  if (!/^[A-Za-z]+$/.test(letters)) throw new Error(`无效的列地址：${letters}`);
  let result = 0;
  for (const char of letters.toUpperCase()) {
    result = result * 26 + char.charCodeAt(0) - 64;
  }
  return result;
}

export function columnNumberToLetters(column: number): string {
  if (!Number.isInteger(column) || column < 1) throw new Error("列号必须是正整数。");
  let value = column;
  let output = "";
  while (value > 0) {
    value -= 1;
    output = String.fromCharCode(65 + (value % 26)) + output;
    value = Math.floor(value / 26);
  }
  return output;
}

export function toA1Address(row: number, col: number): string {
  return `${columnNumberToLetters(col)}${row}`;
}
