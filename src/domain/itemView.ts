import type { AssetCandidate } from "./models";

export type ItemFilter =
  | "all"
  | "ready"
  | "error"
  | "warning"
  | "imageMissing"
  | "imageAmbiguous"
  | "numericIdMissing"
  | "assetCodeDuplicate";

export type ItemSort = "source" | "assetCode" | "numericId" | "name";

export interface ItemViewOptions {
  filter: ItemFilter;
  prefix: string;
  sort: ItemSort;
}

export function filterAndSortItems(items: AssetCandidate[], options: ItemViewOptions): AssetCandidate[] {
  return items
    .filter((item) => options.prefix === "all" || item.prefix === options.prefix)
    .filter((item) => matchesItemFilter(item, options.filter))
    .sort((left, right) => compareItems(left, right, options.sort));
}

export function matchesItemFilter(item: AssetCandidate, filter: ItemFilter): boolean {
  if (filter === "ready") return !hasSeverity(item, "error");
  if (filter === "error") return hasSeverity(item, "error");
  if (filter === "warning") return hasSeverity(item, "warning");
  if (filter === "imageMissing") return hasIssue(item, "IMAGE_MISSING");
  if (filter === "imageAmbiguous") return item.imageCandidates.length > 1;
  if (filter === "numericIdMissing") return hasIssue(item, "NUMERIC_ID_MISSING");
  if (filter === "assetCodeDuplicate") return hasIssue(item, "ASSET_CODE_DUPLICATE");
  return true;
}

function compareItems(left: AssetCandidate, right: AssetCandidate, sort: ItemSort): number {
  let result = 0;
  if (sort === "assetCode") result = compareText(left.assetCode, right.assetCode);
  if (sort === "numericId") result = compareOptionalText(left.numericId, right.numericId);
  if (sort === "name") result = compareOptionalText(left.name, right.name);
  return result || compareSource(left, right);
}

function compareSource(left: AssetCandidate, right: AssetCandidate): number {
  return (
    left.sourceOrder - right.sourceOrder ||
    left.codeRow - right.codeRow ||
    left.codeCol - right.codeCol ||
    compareText(left.key, right.key)
  );
}

function compareOptionalText(left: string | undefined, right: string | undefined): number {
  if (left === undefined && right === undefined) return 0;
  if (left === undefined) return 1;
  if (right === undefined) return -1;
  return compareText(left, right);
}

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function hasSeverity(item: AssetCandidate, severity: "error" | "warning"): boolean {
  return item.issues.some((issue) => issue.severity === severity);
}

function hasIssue(item: AssetCandidate, code: string): boolean {
  return item.issues.some((issue) => issue.code === code);
}
