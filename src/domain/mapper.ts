import type { AssetCandidate, CellRecord, ImageAnchor, ImageCandidate, ParsedSheet, ValidationIssue } from "./models";
import { isPositionInRange, parseA1Range, toA1Address, type A1Range } from "../utils/a1";

export const ASSET_CODE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/;
const KNOWN_PREFIXES = ["dish_", "box_", "ds_", "c_", "g_", "m_"];

export function mapAssets(parsedSheet: ParsedSheet, rangeInput?: string): AssetCandidate[] {
  const range = rangeInput?.trim() ? parseA1Range(rangeInput) : undefined;
  const cellMap = new Map(parsedSheet.cells.map((cell) => [`${cell.row}:${cell.col}`, cell]));
  const imagesByColumn = groupImagesByColumn(parsedSheet.images);
  const candidates: AssetCandidate[] = [];

  const sourceCells = [...parsedSheet.cells].sort((left, right) => left.row - right.row || left.col - right.col);
  for (const cell of sourceCells) {
    if (!isPositionInRange(cell, range)) continue;
    const assetCode = scalarText(cell).trim();
    if (!ASSET_CODE_PATTERN.test(assetCode)) continue;
    if (!isLikelyAssetCode(cell, assetCode, cellMap, imagesByColumn)) continue;

    const numericCell = findNumericIdCell(cell, cellMap);
    const nameCell = findNameCell(cell, numericCell, cellMap);
    const imageCandidates = findImageCandidates(cell, imagesByColumn);
    const prefix = detectPrefix(assetCode);
    const key = `${parsedSheet.descriptor.name}!${cell.address}`;
    const candidate: AssetCandidate = {
      key,
      assetCode,
      numericId: numericCell ? scalarText(numericCell).trim() : undefined,
      name: nameCell ? scalarText(nameCell).trim() : undefined,
      prefix,
      sheetName: parsedSheet.descriptor.name,
      codeCell: cell.address,
      codeRow: cell.row,
      codeCol: cell.col,
      nameCell: nameCell?.address,
      numericIdCell: numericCell?.address,
      sourceGroupId: `${parsedSheet.descriptor.name}!codeRow:${cell.row}`,
      sourceOrder: candidates.length,
      imageCandidates,
      selectedImageId: defaultImageCandidateId(imageCandidates),
      issues: [],
      selected: false
    };
    candidate.issues = validateCandidate(candidate);
    candidate.selected = !candidate.issues.some((issue) => issue.severity === "error");
    candidates.push(candidate);
  }

  addStructuredInvalidCandidates(parsedSheet, range, cellMap, imagesByColumn, candidates, sourceCells);
  candidates.sort((left, right) => left.codeRow - right.codeRow || left.codeCol - right.codeCol);
  candidates.forEach((candidate, sourceOrder) => {
    candidate.sourceOrder = sourceOrder;
  });
  applyDuplicateIssues(candidates);
  for (const candidate of candidates) {
    candidate.selected = !candidate.issues.some((issue) => issue.severity === "error");
  }
  return candidates;
}

export function selectImageCandidate(item: AssetCandidate, imageId: string | undefined): AssetCandidate {
  const updated = { ...item, selectedImageId: imageId };
  const taskLevelIssues = item.issues.filter(
    (issue) => issue.code === "ASSET_CODE_DUPLICATE" || issue.code === "NUMERIC_ID_DUPLICATE"
  );
  updated.issues = [...validateCandidate(updated), ...taskLevelIssues];
  updated.selected = !updated.issues.some((issue) => issue.severity === "error");
  return updated;
}

export function applyScopedTaskValidation(items: AssetCandidate[]): AssetCandidate[] {
  const scoped = items.map((item) => ({
    ...item,
    issues: item.issues.filter(
      (issue) => issue.code !== "ASSET_CODE_DUPLICATE" && issue.code !== "NUMERIC_ID_DUPLICATE"
    )
  }));
  applyDuplicateIssues(scoped);
  return scoped.map((item) => ({
    ...item,
    selected: item.selected && !item.issues.some((issue) => issue.severity === "error")
  }));
}

function isLikelyAssetCode(
  cell: CellRecord,
  assetCode: string,
  cellMap: Map<string, CellRecord>,
  imagesByColumn: Map<number, ImageAnchor[]>
): boolean {
  if (hasKnownPrefix(assetCode)) return true;
  if (/^\d+$/.test(scalarText(cellMap.get(`${cell.row - 1}:${cell.col}`)).trim())) return false;
  if (/^\d+$/.test(scalarText(cellMap.get(`${cell.row - 2}:${cell.col}`)).trim())) return true;
  if (!looksLikeCodeToken(assetCode)) return false;
  return (imagesByColumn.get(cell.col) ?? []).some(
    (image) => image.fromRow > cell.row && image.fromRow <= cell.row + 3
  );
}

function addStructuredInvalidCandidates(
  parsedSheet: ParsedSheet,
  range: A1Range | undefined,
  cellMap: Map<string, CellRecord>,
  imagesByColumn: Map<number, ImageAnchor[]>,
  candidates: AssetCandidate[],
  sourceCells: CellRecord[]
): void {
  const existingKeys = new Set(candidates.map((candidate) => candidate.key));
  for (const numericCell of sourceCells) {
    if (!/^\d+$/.test(scalarText(numericCell).trim())) continue;
    const firstNameCell = cellMap.get(`${numericCell.row + 1}:${numericCell.col}`);
    if (!firstNameCell || !isNameValue(firstNameCell)) continue;
    const possibleCodeRows = [numericCell.row + 2, numericCell.row + 3, numericCell.row + 4];
    const validCodeNearby = possibleCodeRows.some((row) => {
      const value = scalarText(cellMap.get(`${row}:${numericCell.col}`)).trim();
      return ASSET_CODE_PATTERN.test(value) && looksLikeCodeToken(value);
    });
    if (validCodeNearby) continue;

    let codeRow = possibleCodeRows[0]!;
    for (const row of possibleCodeRows) {
      const value = scalarText(cellMap.get(`${row}:${numericCell.col}`)).trim();
      codeRow = row;
      if (!value || looksLikeInvalidCodeToken(value)) break;
    }
    const codeCell = cellMap.get(`${codeRow}:${numericCell.col}`);
    const codeAddress = codeCell?.address ?? toA1Address(codeRow, numericCell.col);
    const key = `${parsedSheet.descriptor.name}!${codeAddress}`;
    if (existingKeys.has(key) || !isPositionInRange({ row: codeRow, col: numericCell.col }, range)) continue;
    const assetCode = scalarText(codeCell).trim();
    if (ASSET_CODE_PATTERN.test(assetCode)) continue;
    const imageCandidates = findImageCandidates({ row: codeRow, col: numericCell.col }, imagesByColumn);
    if (imageCandidates.length === 0) continue;
    let nameCell = firstNameCell;
    for (let row = codeRow - 1; row > numericCell.row; row -= 1) {
      const candidate = cellMap.get(`${row}:${numericCell.col}`);
      if (candidate && isNameValue(candidate)) {
        nameCell = candidate;
        break;
      }
    }

    const candidate: AssetCandidate = {
      key,
      assetCode,
      numericId: scalarText(numericCell).trim(),
      name: scalarText(nameCell).trim(),
      prefix: detectPrefix(assetCode),
      sheetName: parsedSheet.descriptor.name,
      codeCell: codeAddress,
      codeRow,
      codeCol: numericCell.col,
      nameCell: nameCell.address,
      numericIdCell: numericCell.address,
      sourceGroupId: `${parsedSheet.descriptor.name}!codeRow:${codeRow}`,
      sourceOrder: candidates.length,
      imageCandidates,
      selectedImageId: defaultImageCandidateId(imageCandidates),
      issues: [],
      selected: false
    };
    candidate.issues = validateCandidate(candidate);
    candidate.selected = !candidate.issues.some((issue) => issue.severity === "error");
    candidates.push(candidate);
    existingKeys.add(key);
  }
}

function findNumericIdCell(cell: CellRecord, cellMap: Map<string, CellRecord>): CellRecord | undefined {
  const exact = cellMap.get(`${cell.row - 2}:${cell.col}`);
  if (exact && /^\d+$/.test(scalarText(exact).trim())) return exact;
  for (let offset = 1; offset <= 4; offset += 1) {
    const candidate = cellMap.get(`${cell.row - offset}:${cell.col}`);
    if (candidate && /^\d+$/.test(scalarText(candidate).trim())) return candidate;
  }
  return undefined;
}

function findNameCell(
  cell: CellRecord,
  numericCell: CellRecord | undefined,
  cellMap: Map<string, CellRecord>
): CellRecord | undefined {
  const exact = cellMap.get(`${cell.row - 1}:${cell.col}`);
  if (exact && isNameValue(exact)) return exact;
  const minimumRow = numericCell?.row ?? Math.max(1, cell.row - 4);
  for (let row = cell.row - 1; row > minimumRow; row -= 1) {
    const candidate = cellMap.get(`${row}:${cell.col}`);
    if (candidate && isNameValue(candidate)) return candidate;
  }
  return undefined;
}

function findImageCandidates(
  cell: Pick<CellRecord, "row" | "col">,
  imagesByColumn: Map<number, ImageAnchor[]>
): ImageCandidate[] {
  return (imagesByColumn.get(cell.col) ?? [])
    .filter((image) => image.fromRow > cell.row && image.fromRow <= cell.row + 3)
    .map((anchor) => ({
      id: anchor.id,
      anchor,
      relativeRowOffset: anchor.fromRow - cell.row,
      relativeColOffset: anchor.fromCol - cell.col,
      thumbnailState: "notLoaded"
    }));
}

function validateCandidate(item: AssetCandidate): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (!item.assetCode) {
    issues.push(issue("ASSET_CODE_MISSING", "warning", "缺少 assetCode；生成时画板名称将留空。", item));
  } else if (!ASSET_CODE_PATTERN.test(item.assetCode)) {
    issues.push(issue("ASSET_CODE_INVALID", "error", "assetCode 格式非法。", item));
  }
  if (!item.numericId) issues.push(issue("NUMERIC_ID_MISSING", "warning", "缺少 numericId。", item));
  if (!item.name) issues.push(issue("NAME_MISSING", "warning", "缺少名称。", item));
  if (item.assetCode && item.prefix === "other") {
    issues.push(issue("NON_STANDARD_PREFIX", "warning", "非标准 assetCode 前缀。", item));
  }
  if (item.imageCandidates.length === 0) issues.push(issue("IMAGE_MISSING", "error", "未找到关联图片。", item));
  if (item.imageCandidates.length > 0 && !item.selectedImageId) {
    issues.push(issue("IMAGE_SELECTION_MISSING", "error", "尚未选择关联图片。", item));
  }
  if (item.selectedImageId && !item.imageCandidates.some((candidate) => candidate.id === item.selectedImageId)) {
    issues.push(issue("IMAGE_SELECTION_INVALID", "error", "所选图片候选不存在，请重新选择。", item));
  }
  const selectedImage = item.imageCandidates.find((candidate) => candidate.id === item.selectedImageId);
  if (selectedImage?.anchor.mediaType === "other") {
    issues.push(issue("UNSUPPORTED_MEDIA_TYPE", "error", "所选图片格式不受支持。", item));
  }
  return issues;
}

function applyDuplicateIssues(items: AssetCandidate[]): void {
  const codeGroups = new Map<string, AssetCandidate[]>();
  for (const item of items) {
    if (!item.assetCode) continue;
    const key = item.assetCode.toLowerCase();
    codeGroups.set(key, [...(codeGroups.get(key) ?? []), item]);
  }
  for (const duplicates of codeGroups.values()) {
    if (duplicates.length < 2) continue;
    for (const item of duplicates) {
      item.issues.push(issue("ASSET_CODE_DUPLICATE", "error", "当前任务中 assetCode 重复。", item));
    }
  }

  const numericIdGroups = new Map<string, AssetCandidate[]>();
  for (const item of items) {
    if (!item.numericId) continue;
    numericIdGroups.set(item.numericId, [...(numericIdGroups.get(item.numericId) ?? []), item]);
  }
  for (const duplicates of numericIdGroups.values()) {
    if (duplicates.length < 2) continue;
    for (const item of duplicates) {
      item.issues.push(issue("NUMERIC_ID_DUPLICATE", "warning", "当前任务中 numericId 重复。", item));
    }
  }
}

function issue(code: string, severity: ValidationIssue["severity"], message: string, item: AssetCandidate): ValidationIssue {
  return { code, severity, message, itemKey: item.key, sourceCell: item.codeCell };
}

function groupImagesByColumn(images: ImageAnchor[]): Map<number, ImageAnchor[]> {
  const result = new Map<number, ImageAnchor[]>();
  const ordered = [...images].sort(
    (left, right) => left.fromRow - right.fromRow || left.fromCol - right.fromCol || left.id.localeCompare(right.id)
  );
  for (const image of ordered) result.set(image.fromCol, [...(result.get(image.fromCol) ?? []), image]);
  return result;
}

function defaultImageCandidateId(candidates: ImageCandidate[]): string | undefined {
  const ordered = [...candidates].sort(
    (left, right) =>
      left.anchor.fromRow - right.anchor.fromRow ||
      left.anchor.fromCol - right.anchor.fromCol ||
      left.id.localeCompare(right.id)
  );
  return ordered[ordered.length - 1]?.id;
}

function detectPrefix(assetCode: string): string {
  const lower = assetCode.toLowerCase();
  return KNOWN_PREFIXES.find((prefix) => lower.startsWith(prefix))?.replace(/_$/, "") ?? "other";
}

function scalarText(cell: CellRecord | undefined): string {
  if (!cell || cell.value === null) return "";
  return String(cell.value);
}

function isNameValue(cell: CellRecord): boolean {
  const value = scalarText(cell).trim();
  return Boolean(value) && !/^\d+$/.test(value) && !hasKnownPrefix(value);
}

function looksLikeCodeToken(value: string): boolean {
  if (!ASSET_CODE_PATTERN.test(value)) return false;
  return hasKnownPrefix(value) || /[_\d]/.test(value);
}

function looksLikeInvalidCodeToken(value: string): boolean {
  return /^[A-Za-z]/.test(value) && /[-_\d]/.test(value) && !ASSET_CODE_PATTERN.test(value);
}

function hasKnownPrefix(value: string): boolean {
  const lower = value.toLowerCase();
  return KNOWN_PREFIXES.some((prefix) => lower.startsWith(prefix));
}
