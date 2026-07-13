import type { AssetCandidate, PsdTemplate } from "./models";

export interface LayoutPlacement {
  item: AssetCandidate;
  row: number;
  col: number;
  rect: { left: number; top: number; right: number; bottom: number };
}

export interface LayoutResult {
  placements: LayoutPlacement[];
  rows: number;
  columns: number;
  width: number;
  height: number;
}

export function layoutItems(items: AssetCandidate[], template: PsdTemplate): LayoutResult {
  const placements: LayoutPlacement[] = [];
  const columns = template.artboard.columns;
  let nextRow = 0;
  let compactIndex = 0;
  const groups = groupContiguous(items);

  for (const group of groups) {
    for (let index = 0; index < group.length; index += 1) {
      const row = template.layout.preserveSourceGroups
        ? nextRow + Math.floor(index / columns)
        : Math.floor(compactIndex / columns);
      const col = template.layout.preserveSourceGroups ? index % columns : compactIndex % columns;
      const left = col * (template.artboard.width + template.artboard.gapX);
      const top = row * (template.artboard.height + template.artboard.gapY);
      placements.push({
        item: group[index]!,
        row,
        col,
        rect: {
          left,
          top,
          right: left + template.artboard.width,
          bottom: top + template.artboard.height
        }
      });
      compactIndex += 1;
    }
    if (template.layout.preserveSourceGroups) nextRow += Math.ceil(group.length / columns);
  }

  const rows = placements.length ? Math.max(...placements.map((placement) => placement.row)) + 1 : 0;
  const usedColumns = placements.length ? Math.max(...placements.map((placement) => placement.col)) + 1 : 0;
  return {
    placements,
    rows,
    columns: usedColumns,
    width:
      usedColumns > 0
        ? usedColumns * template.artboard.width + (usedColumns - 1) * template.artboard.gapX
        : 0,
    height:
      rows > 0 ? rows * template.artboard.height + (rows - 1) * template.artboard.gapY : 0
  };
}

export function splitIntoVolumes(items: AssetCandidate[], maximum: number): AssetCandidate[][] {
  if (!Number.isInteger(maximum) || maximum < 1) throw new Error("单文件画板上限必须是正整数。");
  const volumes: AssetCandidate[][] = [];
  let current: AssetCandidate[] = [];

  for (const group of groupContiguous(items)) {
    if (group.length > maximum) {
      if (current.length) {
        volumes.push(current);
        current = [];
      }
      for (let start = 0; start < group.length; start += maximum) {
        volumes.push(group.slice(start, start + maximum));
      }
      continue;
    }
    if (current.length && current.length + group.length > maximum) {
      volumes.push(current);
      current = [];
    }
    current.push(...group);
  }
  if (current.length) volumes.push(current);
  return volumes;
}

function groupContiguous(items: AssetCandidate[]): AssetCandidate[][] {
  const groups: AssetCandidate[][] = [];
  for (const item of items) {
    const last = groups[groups.length - 1];
    if (last?.[0]?.sourceGroupId === item.sourceGroupId) last.push(item);
    else groups.push([item]);
  }
  return groups;
}
