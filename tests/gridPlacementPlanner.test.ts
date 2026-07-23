import { describe, expect, it } from "vitest";
import {
  assignChainIndexesToSlots,
  findContiguousSlots,
  findFirstEmptyRow,
  findFirstEmptySlot
} from "../src/grid/GridPlacementPlanner";

describe("standard grid placement planner", () => {
  it("finds the first row-major empty slot and skips occupied slots", () => {
    expect(findFirstEmptySlot({ occupiedSlots: new Set() })).toBe("R01C01");
    expect(findFirstEmptySlot({ occupiedSlots: new Set(["R01C01", "R01C02"]) })).toBe("R01C03");
  });

  it("returns an explicit failure when the grid has no empty slot", () => {
    const occupied = new Set<string>();
    for (let row = 1; row <= 8; row += 1) {
      for (let column = 1; column <= 12; column += 1) {
        occupied.add(`R${String(row).padStart(2, "0")}C${String(column).padStart(2, "0")}`);
      }
    }
    expect(findFirstEmptySlot({ occupiedSlots: occupied })).toBeUndefined();
  });

  it("prefers the beginning of a completely empty row", () => {
    expect(findContiguousSlots({ occupiedSlots: new Set(["R01C12"]) }, 3)).toEqual([
      "R02C01", "R02C02", "R02C03"
    ]);
  });

  it("finds only a completely empty row for fixed chain placement", () => {
    expect(findFirstEmptyRow({ occupiedSlots: new Set(["R01C12"]) })?.slice(0, 3)).toEqual([
      "R02C01", "R02C02", "R02C03"
    ]);
    const occupied = new Set<string>();
    for (let row = 1; row <= 8; row += 1) occupied.add(`R${String(row).padStart(2, "0")}C12`);
    expect(findFirstEmptyRow({ occupiedSlots: occupied })).toBeUndefined();
  });

  it("keeps missing chain positions blank instead of compacting later items", () => {
    const row = Array.from({ length: 12 }, (_, index) => `R03C${String(index + 1).padStart(2, "0")}`);
    expect(assignChainIndexesToSlots(row, 8, [0, 2, 3, 7])).toEqual([
      "R03C01", "R03C03", "R03C04", "R03C08"
    ]);
    expect(assignChainIndexesToSlots(row, 13, [0])).toBeUndefined();
    expect(assignChainIndexesToSlots(row, 8, [1, 1])).toBeUndefined();
  });

  it("uses a same-row run when no row is fully empty", () => {
    const occupied = new Set<string>();
    for (let row = 1; row <= 8; row += 1) occupied.add(`R${String(row).padStart(2, "0")}C01`);
    expect(findContiguousSlots({ occupiedSlots: occupied }, 3)).toEqual([
      "R01C02", "R01C03", "R01C04"
    ]);
  });

  it("can cross a row boundary and never returns a partial plan", () => {
    const occupied = new Set<string>();
    for (let row = 1; row <= 8; row += 1) {
      for (let column = 1; column <= 12; column += 1) {
        if (!(row === 1 && column >= 11) && !(row === 2 && column <= 2)) {
          occupied.add(`R${String(row).padStart(2, "0")}C${String(column).padStart(2, "0")}`);
        }
      }
    }
    expect(findContiguousSlots({ occupiedSlots: occupied }, 4)).toEqual([
      "R01C11", "R01C12", "R02C01", "R02C02"
    ]);
    expect(findContiguousSlots({ occupiedSlots: occupied }, 5)).toBeUndefined();
  });

  it("plans more than one row directly as a row-major region", () => {
    const planned = findContiguousSlots({ occupiedSlots: new Set() }, 14);
    expect(planned).toHaveLength(14);
    expect(planned?.[0]).toBe("R01C01");
    expect(planned?.[11]).toBe("R01C12");
    expect(planned?.[13]).toBe("R02C02");
  });
});
