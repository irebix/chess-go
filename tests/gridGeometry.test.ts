import { describe, expect, it } from "vitest";
import {
  allGridSlots,
  constrainBoundsToPrimaryGridSlot,
  gridSlotsOccupiedByBounds,
  gridSlotAt,
  gridSlotsIntersectingBounds
} from "../src/grid/GridGeometry";
import { STANDARD_GRID_TEMPLATE, gridCanvasSize } from "../src/grid/GridTemplate";

describe("standard grid geometry", () => {
  it("computes the fixed 1780 × 1188 canvas and all 96 slots", () => {
    expect(gridCanvasSize()).toEqual({ width: 1780, height: 1188 });
    expect(allGridSlots()).toHaveLength(96);
  });

  it("computes the required corner and adjacent slot bounds", () => {
    expect(gridSlotAt(0, 0)).toMatchObject({
      id: "R01C01",
      bounds: { left: 4, top: 4, right: 148, bottom: 148 },
      centerX: 76,
      centerY: 76
    });
    expect(gridSlotAt(0, 1)).toMatchObject({
      id: "R01C02",
      bounds: { left: 152, top: 4, right: 296, bottom: 148 }
    });
    expect(gridSlotAt(7, 11)).toMatchObject({
      id: "R08C12",
      bounds: { left: 1632, top: 1040, right: 1776, bottom: 1184 }
    });
  });

  it("keeps four-pixel outer margins and gaps", () => {
    const first = gridSlotAt(0, 0);
    const second = gridSlotAt(0, 1);
    const below = gridSlotAt(1, 0);
    const last = gridSlotAt(7, 11);
    expect(first.bounds.left).toBe(4);
    expect(first.bounds.top).toBe(4);
    expect(STANDARD_GRID_TEMPLATE.canvas.width - last.bounds.right).toBe(4);
    expect(STANDARD_GRID_TEMPLATE.canvas.height - last.bounds.bottom).toBe(4);
    expect(second.bounds.left - first.bounds.right).toBe(4);
    expect(below.bounds.top - first.bounds.bottom).toBe(4);
  });

  it("maps single, two-cell and 2 × 2 bounds without counting gaps", () => {
    expect(gridSlotsIntersectingBounds({ left: 10, top: 10, right: 100, bottom: 100 }).map(slotId))
      .toEqual(["R01C01"]);
    expect(gridSlotsIntersectingBounds({ left: 10, top: 10, right: 170, bottom: 100 }).map(slotId))
      .toEqual(["R01C01", "R01C02"]);
    expect(gridSlotsIntersectingBounds({ left: 10, top: 10, right: 170, bottom: 170 }).map(slotId))
      .toEqual(["R01C01", "R01C02", "R02C01", "R02C02"]);
    expect(gridSlotsIntersectingBounds({ left: 148.5, top: 10, right: 151.5, bottom: 100 }))
      .toEqual([]);
  });

  it("ignores slight overflow into a neighboring cell but keeps meaningful multi-cell overlap", () => {
    expect(gridSlotsOccupiedByBounds({ left: 20, top: 20, right: 158, bottom: 128 }).map(slotId))
      .toEqual(["R01C01"]);
    expect(gridSlotsOccupiedByBounds({ left: 20, top: 20, right: 220, bottom: 128 }).map(slotId))
      .toEqual(["R01C01", "R01C02"]);
    expect(gridSlotsOccupiedByBounds({ left: 10, top: 10, right: 20, bottom: 20 }).map(slotId))
      .toEqual(["R01C01"]);
    expect(gridSlotsOccupiedByBounds({ left: 148.5, top: 10, right: 151.5, bottom: 100 }))
      .toEqual([]);
  });

  it("keeps source placement when possible and constrains refinement targets to the primary slot", () => {
    expect(constrainBoundsToPrimaryGridSlot({ left: 20, top: 20, right: 120, bottom: 120 }))
      .toMatchObject({
        slot: { id: "R01C01" },
        bounds: { left: 20, top: 20, right: 120, bottom: 120 }
      });
    expect(constrainBoundsToPrimaryGridSlot({ left: 20, top: 20, right: 158, bottom: 128 }))
      .toMatchObject({
        slot: { id: "R01C01" },
        bounds: { left: 10, top: 20, right: 148, bottom: 128 }
      });
    expect(constrainBoundsToPrimaryGridSlot({ left: -20, top: -20, right: 220, bottom: 200 }))
      .toMatchObject({
        slot: { id: "R01C01" },
        bounds: { left: 4, top: 4, right: 148, bottom: 148 }
      });
    expect(constrainBoundsToPrimaryGridSlot({ left: 148.5, top: 20, right: 151.5, bottom: 120 }))
      .toBeUndefined();
  });
});

function slotId(slot: { id: string }): string {
  return slot.id;
}
