import { allGridSlots, gridSlotAt } from "./GridGeometry";
import { STANDARD_GRID_TEMPLATE, type GridTemplate } from "./GridTemplate";

export interface GridPlacementOccupancy {
  occupiedSlots: ReadonlySet<string>;
  reservedSlots?: ReadonlySet<string>;
}

export function findFirstEmptySlot(
  occupancy: GridPlacementOccupancy,
  template: GridTemplate = STANDARD_GRID_TEMPLATE
): string | undefined {
  return allGridSlots(template).find((slot) => !isUnavailable(slot.id, occupancy))?.id;
}

export function findFirstEmptyRow(
  occupancy: GridPlacementOccupancy,
  template: GridTemplate = STANDARD_GRID_TEMPLATE
): string[] | undefined {
  for (let row = 0; row < template.grid.rows; row += 1) {
    const rowSlotIds = Array.from(
      { length: template.grid.columns },
      (_, column) => gridSlotAt(row, column, template).id
    );
    if (rowSlotIds.every((slotId) => !isUnavailable(slotId, occupancy))) return rowSlotIds;
  }
  return undefined;
}

export function assignChainIndexesToSlots(
  rowSlotIds: readonly string[],
  chainLength: number,
  chainIndexes: readonly number[]
): string[] | undefined {
  if (!Number.isInteger(chainLength) || chainLength <= 0 || chainLength > rowSlotIds.length) {
    return undefined;
  }
  if (new Set(chainIndexes).size !== chainIndexes.length) return undefined;
  if (chainIndexes.some((index) => !Number.isInteger(index) || index < 0 || index >= chainLength)) {
    return undefined;
  }
  return chainIndexes.map((index) => rowSlotIds[index]!);
}

export function findContiguousSlots(
  occupancy: GridPlacementOccupancy,
  count: number,
  template: GridTemplate = STANDARD_GRID_TEMPLATE
): string[] | undefined {
  if (!Number.isInteger(count) || count <= 0) return undefined;
  const total = template.grid.columns * template.grid.rows;
  if (count > total) return undefined;

  if (count <= template.grid.columns) {
    const emptyRow = findFirstEmptyRow(occupancy, template);
    if (emptyRow) return emptyRow.slice(0, count);

    for (let row = 0; row < template.grid.rows; row += 1) {
      const run = findRun(
        Array.from(
          { length: template.grid.columns },
          (_, column) => gridSlotAt(row, column, template).id
        ),
        occupancy,
        count
      );
      if (run) return run;
    }
  }

  return findRun(allGridSlots(template).map((slot) => slot.id), occupancy, count);
}

function findRun(
  slotIds: string[],
  occupancy: GridPlacementOccupancy,
  count: number
): string[] | undefined {
  let start = 0;
  for (let index = 0; index < slotIds.length; index += 1) {
    const slotId = slotIds[index]!;
    if (isUnavailable(slotId, occupancy)) {
      start = index + 1;
      continue;
    }
    if (index - start + 1 >= count) return slotIds.slice(start, start + count);
  }
  return undefined;
}

function isUnavailable(slotId: string, occupancy: GridPlacementOccupancy): boolean {
  return occupancy.occupiedSlots.has(slotId) || Boolean(occupancy.reservedSlots?.has(slotId));
}
