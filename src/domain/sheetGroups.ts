import type { AssetCandidate, CellRecord, MergedCellRange, ParsedSheet, SheetGroup, SheetGroupSegment } from "./models";

interface PhysicalGroupSegment extends SheetGroupSegment {
  label: string;
  sourceCell: string;
  itemCount: number;
}

interface LogicalGroupDraft {
  label: string;
  sourceCell: string;
  segments: PhysicalGroupSegment[];
  inferredContinuation: boolean;
}

export function discoverSheetGroups(parsedSheet: ParsedSheet, items: AssetCandidate[]): SheetGroup[] {
  if (!items.length) return [];
  const physicalSegments = parsedSheet.mergedCells
    .filter((range) => range.startCol === 1 && range.endCol === 1 && range.endRow > range.startRow)
    .sort((left, right) => left.startRow - right.startRow)
    .map((range) => physicalSegment(range, parsedSheet.cells, items));
  const drafts: LogicalGroupDraft[] = [];
  let currentNamedGroup: LogicalGroupDraft | undefined;

  for (let index = 0; index < physicalSegments.length; index += 1) {
    const segment = physicalSegments[index]!;
    if (segment.label) {
      if (currentNamedGroup && normalizeLabel(currentNamedGroup.label) === normalizeLabel(segment.label)) {
        currentNamedGroup.segments.push(segment);
      } else {
        currentNamedGroup = {
          label: segment.label,
          sourceCell: segment.sourceCell,
          segments: [segment],
          inferredContinuation: false
        };
        drafts.push(currentNamedGroup);
      }
      continue;
    }

    if (!segment.itemCount) continue;
    const hasNamedSegmentAfter = physicalSegments.slice(index + 1).some((candidate) => Boolean(candidate.label));
    if (currentNamedGroup && hasNamedSegmentAfter) {
      currentNamedGroup.segments.push(segment);
      currentNamedGroup.inferredContinuation = true;
      continue;
    }
    currentNamedGroup = undefined;
    drafts.push({
      label: `未命名分组（${segment.ref}）`,
      sourceCell: segment.sourceCell,
      segments: [segment],
      inferredContinuation: false
    });
  }

  const groups = drafts.flatMap((draft) => {
    const groupItems = uniqueItemsInSegments(items, draft.segments);
    if (!groupItems.length) return [];
    const startRow = draft.segments[0]!.startRow;
    const endRow = draft.segments[draft.segments.length - 1]!.endRow;
    return [
      {
        id: `${parsedSheet.descriptor.name}!A${startRow}:A${endRow}`,
        label: draft.label,
        sourceCell: draft.sourceCell,
        startRow,
        endRow,
        itemCount: groupItems.length,
        physicalSegments: draft.segments.map(({ ref, startRow: segmentStart, endRow: segmentEnd }) => ({
          ref,
          startRow: segmentStart,
          endRow: segmentEnd
        })),
        inferredContinuation: draft.inferredContinuation
      } satisfies SheetGroup
    ];
  });
  if (groups.length) return groups;

  const minimumItemRow = Math.min(...items.map((item) => item.codeRow));
  const maximumItemRow = Math.max(...items.map((item) => item.codeRow));
  return [
    {
      id: `${parsedSheet.descriptor.name}!all`,
      label: "全部已识别项目",
      sourceCell: "A1",
      startRow: minimumItemRow,
      endRow: maximumItemRow,
      itemCount: items.length,
      physicalSegments: [],
      inferredContinuation: false
    }
  ];
}

export function filterItemsByGroups(items: AssetCandidate[], groups: SheetGroup[]): AssetCandidate[] {
  if (!groups.length) return [];
  return items.filter((item) => groups.some((group) => isRowInGroup(item.codeRow, group)));
}

function physicalSegment(
  range: MergedCellRange,
  cells: CellRecord[],
  items: AssetCandidate[]
): PhysicalGroupSegment {
  const labelCell = cells.find((cell) => cell.row === range.startRow && cell.col === 1);
  const label = labelCell?.value === null || labelCell?.value === undefined ? "" : String(labelCell.value).trim();
  return {
    ref: range.ref,
    startRow: range.startRow,
    endRow: range.endRow,
    label,
    sourceCell: labelCell?.address ?? `A${range.startRow}`,
    itemCount: items.filter((item) => item.codeRow >= range.startRow && item.codeRow <= range.endRow).length
  };
}

function uniqueItemsInSegments(items: AssetCandidate[], segments: SheetGroupSegment[]): AssetCandidate[] {
  const keys = new Set<string>();
  return items.filter((item) => {
    if (!segments.some((segment) => item.codeRow >= segment.startRow && item.codeRow <= segment.endRow)) return false;
    if (keys.has(item.key)) return false;
    keys.add(item.key);
    return true;
  });
}

function isRowInGroup(row: number, group: SheetGroup): boolean {
  if (!group.physicalSegments.length) return row >= group.startRow && row <= group.endRow;
  return group.physicalSegments.some((segment) => row >= segment.startRow && row <= segment.endRow);
}

function normalizeLabel(value: string): string {
  return value.replace(/\s+/g, "").toLocaleLowerCase();
}
