import { filterSelectedItemsByGroups } from "./sheetGroups";
import type { AssetCandidate, SheetGroup } from "./models";
import { STANDARD_GRID_TEMPLATE } from "../grid/GridTemplate";

export const TABLE_GRID_CHAINS_PER_VOLUME = STANDARD_GRID_TEMPLATE.grid.rows;
export const TABLE_GRID_ITEMS_PER_CHAIN = STANDARD_GRID_TEMPLATE.grid.columns;

export interface TableGridPlannedItem {
  item: AssetCandidate;
  column: number;
}

export interface TableGridPlannedChain {
  group: SheetGroup;
  row: number;
  items: TableGridPlannedItem[];
}

export interface TableGridVolumePlan {
  volumeNumber: number;
  chains: TableGridPlannedChain[];
  itemCount: number;
}

export function planTableGridVolumes(
  selectedGroups: readonly SheetGroup[],
  items: readonly AssetCandidate[]
): TableGridVolumePlan[] {
  const seenGroupIds = new Set<string>();
  const orderedGroups = [...selectedGroups].sort(
    (left, right) =>
      left.startRow - right.startRow
      || left.endRow - right.endRow
      || left.id.localeCompare(right.id)
  );
  const chains = orderedGroups.flatMap((group) => {
    if (seenGroupIds.has(group.id)) {
      throw new Error(`表格网格包含重复棋子链：${group.label}。`);
    }
    seenGroupIds.add(group.id);
    const selectedItems = filterSelectedItemsByGroups(
      [...items],
      [group]
    ).sort(compareTableGridItems);
    if (!selectedItems.length) return [];
    if (selectedItems.length > TABLE_GRID_ITEMS_PER_CHAIN) {
      throw new Error(
        `棋子链“${group.label}”已选择 ${selectedItems.length} 项，`
          + `超过标准网格单行 ${TABLE_GRID_ITEMS_PER_CHAIN} 格上限。`
      );
    }
    return [{
      group,
      items: selectedItems.map((item, column) => ({ item, column }))
    }];
  });

  if (!chains.length) throw new Error("没有选择可生成到网格的棋子。");

  const volumes: TableGridVolumePlan[] = [];
  for (let start = 0; start < chains.length; start += TABLE_GRID_CHAINS_PER_VOLUME) {
    const volumeChains = chains
      .slice(start, start + TABLE_GRID_CHAINS_PER_VOLUME)
      .map((chain, row) => ({ ...chain, row }));
    volumes.push({
      volumeNumber: volumes.length + 1,
      chains: volumeChains,
      itemCount: volumeChains.reduce((count, chain) => count + chain.items.length, 0)
    });
  }
  return volumes;
}

function compareTableGridItems(left: AssetCandidate, right: AssetCandidate): number {
  return left.codeRow - right.codeRow
    || left.codeCol - right.codeCol
    || left.sourceOrder - right.sourceOrder
    || left.assetCode.localeCompare(right.assetCode);
}
