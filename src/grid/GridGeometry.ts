import {
  GRID_INTERSECTION_EPSILON,
  GRID_OCCUPANCY_MIN_OVERLAP_RATIO,
  STANDARD_GRID_TEMPLATE,
  gridPitchX,
  gridPitchY,
  type GridTemplate
} from "./GridTemplate";

export interface GridRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface GridSlot {
  id: string;
  row: number;
  column: number;
  bounds: GridRect;
  centerX: number;
  centerY: number;
}

export interface GridConstrainedBounds {
  slot: GridSlot;
  bounds: GridRect;
}

export function gridSlotId(row: number, column: number): string {
  if (!Number.isInteger(row) || !Number.isInteger(column) || row < 0 || column < 0) {
    throw new Error("Grid row and column must be non-negative integers.");
  }
  return `R${String(row + 1).padStart(2, "0")}C${String(column + 1).padStart(2, "0")}`;
}

export function parseGridSlotId(
  slotId: string,
  template: GridTemplate = STANDARD_GRID_TEMPLATE
): { row: number; column: number } | undefined {
  const match = /^R(\d{2})C(\d{2})$/.exec(slotId);
  if (!match) return undefined;
  const row = Number(match[1]) - 1;
  const column = Number(match[2]) - 1;
  return row >= 0 && row < template.grid.rows && column >= 0 && column < template.grid.columns
    ? { row, column }
    : undefined;
}

export function gridSlotAt(
  row: number,
  column: number,
  template: GridTemplate = STANDARD_GRID_TEMPLATE
): GridSlot {
  if (
    !Number.isInteger(row) || !Number.isInteger(column) ||
    row < 0 || row >= template.grid.rows ||
    column < 0 || column >= template.grid.columns
  ) {
    throw new Error(`Grid slot is out of range: row=${row}, column=${column}.`);
  }
  const left = template.grid.marginX + column * gridPitchX(template);
  const top = template.grid.marginY + row * gridPitchY(template);
  const bounds = {
    left,
    top,
    right: left + template.grid.cellWidth,
    bottom: top + template.grid.cellHeight
  };
  return {
    id: gridSlotId(row, column),
    row,
    column,
    bounds,
    centerX: left + template.grid.cellWidth / 2,
    centerY: top + template.grid.cellHeight / 2
  };
}

export function gridSlotFromId(
  slotId: string,
  template: GridTemplate = STANDARD_GRID_TEMPLATE
): GridSlot {
  const coordinates = parseGridSlotId(slotId, template);
  if (!coordinates) throw new Error(`Unknown grid slot: ${slotId}.`);
  return gridSlotAt(coordinates.row, coordinates.column, template);
}

export function allGridSlots(template: GridTemplate = STANDARD_GRID_TEMPLATE): GridSlot[] {
  const slots: GridSlot[] = [];
  for (let row = 0; row < template.grid.rows; row += 1) {
    for (let column = 0; column < template.grid.columns; column += 1) {
      slots.push(gridSlotAt(row, column, template));
    }
  }
  return slots;
}

export function positiveIntersection(
  left: GridRect,
  right: GridRect,
  epsilon = GRID_INTERSECTION_EPSILON
): boolean {
  const intersectionWidth = Math.min(left.right, right.right) - Math.max(left.left, right.left);
  const intersectionHeight = Math.min(left.bottom, right.bottom) - Math.max(left.top, right.top);
  return intersectionWidth > epsilon && intersectionHeight > epsilon;
}

export function clipRectToCanvas(
  bounds: GridRect,
  template: GridTemplate = STANDARD_GRID_TEMPLATE
): GridRect | undefined {
  const clipped = {
    left: Math.max(0, bounds.left),
    top: Math.max(0, bounds.top),
    right: Math.min(template.canvas.width, bounds.right),
    bottom: Math.min(template.canvas.height, bounds.bottom)
  };
  return clipped.right > clipped.left && clipped.bottom > clipped.top ? clipped : undefined;
}

export function gridSlotsIntersectingBounds(
  bounds: GridRect,
  template: GridTemplate = STANDARD_GRID_TEMPLATE,
  epsilon = GRID_INTERSECTION_EPSILON
): GridSlot[] {
  const clipped = clipRectToCanvas(bounds, template);
  if (!clipped) return [];
  const pitchX = gridPitchX(template);
  const pitchY = gridPitchY(template);
  const startColumn = clamp(
    Math.floor((clipped.left - template.grid.marginX) / pitchX),
    0,
    template.grid.columns - 1
  );
  const endColumn = clamp(
    Math.floor((clipped.right - template.grid.marginX) / pitchX),
    0,
    template.grid.columns - 1
  );
  const startRow = clamp(
    Math.floor((clipped.top - template.grid.marginY) / pitchY),
    0,
    template.grid.rows - 1
  );
  const endRow = clamp(
    Math.floor((clipped.bottom - template.grid.marginY) / pitchY),
    0,
    template.grid.rows - 1
  );

  const slots: GridSlot[] = [];
  for (let row = startRow; row <= endRow; row += 1) {
    for (let column = startColumn; column <= endColumn; column += 1) {
      const slot = gridSlotAt(row, column, template);
      if (positiveIntersection(clipped, slot.bounds, epsilon)) slots.push(slot);
    }
  }
  return slots;
}

export function gridBoundsOccupiesSlot(
  bounds: GridRect,
  slotBounds: GridRect,
  template: GridTemplate = STANDARD_GRID_TEMPLATE,
  minimumOverlapRatio = GRID_OCCUPANCY_MIN_OVERLAP_RATIO
): boolean {
  const clipped = clipRectToCanvas(bounds, template);
  if (!clipped || !positiveIntersection(clipped, slotBounds)) return false;
  const intersectionWidth = Math.min(clipped.right, slotBounds.right) - Math.max(clipped.left, slotBounds.left);
  const intersectionHeight = Math.min(clipped.bottom, slotBounds.bottom) - Math.max(clipped.top, slotBounds.top);
  const intersectionArea = intersectionWidth * intersectionHeight;
  const layerArea = (clipped.right - clipped.left) * (clipped.bottom - clipped.top);
  const slotArea = (slotBounds.right - slotBounds.left) * (slotBounds.bottom - slotBounds.top);
  const referenceArea = Math.min(layerArea, slotArea);
  return referenceArea > 0 && intersectionArea / referenceArea >= minimumOverlapRatio;
}

export function gridSlotsOccupiedByBounds(
  bounds: GridRect,
  template: GridTemplate = STANDARD_GRID_TEMPLATE
): GridSlot[] {
  return gridSlotsIntersectingBounds(bounds, template)
    .filter((slot) => gridBoundsOccupiesSlot(bounds, slot.bounds, template));
}

export function primaryGridSlotForBounds(
  bounds: GridRect,
  template: GridTemplate = STANDARD_GRID_TEMPLATE
): GridSlot | undefined {
  let best: { slot: GridSlot; intersectionArea: number } | undefined;
  for (const slot of gridSlotsOccupiedByBounds(bounds, template)) {
    const intersectionWidth = Math.min(bounds.right, slot.bounds.right) - Math.max(bounds.left, slot.bounds.left);
    const intersectionHeight = Math.min(bounds.bottom, slot.bounds.bottom) - Math.max(bounds.top, slot.bounds.top);
    const intersectionArea = Math.max(0, intersectionWidth) * Math.max(0, intersectionHeight);
    if (!best || intersectionArea > best.intersectionArea) best = { slot, intersectionArea };
  }
  return best?.slot;
}

export function constrainBoundsToPrimaryGridSlot(
  bounds: GridRect,
  template: GridTemplate = STANDARD_GRID_TEMPLATE
): GridConstrainedBounds | undefined {
  const slot = primaryGridSlotForBounds(bounds, template);
  if (!slot) return undefined;
  const sourceWidth = bounds.right - bounds.left;
  const sourceHeight = bounds.bottom - bounds.top;
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) return undefined;
  const slotWidth = slot.bounds.right - slot.bounds.left;
  const slotHeight = slot.bounds.bottom - slot.bounds.top;
  const width = Math.min(sourceWidth, slotWidth);
  const height = Math.min(sourceHeight, slotHeight);
  const centerX = clamp(
    (bounds.left + bounds.right) / 2,
    slot.bounds.left + width / 2,
    slot.bounds.right - width / 2
  );
  const centerY = clamp(
    (bounds.top + bounds.bottom) / 2,
    slot.bounds.top + height / 2,
    slot.bounds.bottom - height / 2
  );
  return {
    slot,
    bounds: {
      left: centerX - width / 2,
      top: centerY - height / 2,
      right: centerX + width / 2,
      bottom: centerY + height / 2
    }
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
