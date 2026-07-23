import { describe, expect, it } from "vitest";
import {
  isGridCanvasBackdropBounds,
  scanGridLayerSnapshots
} from "../src/grid/GridOccupancyScanner";
import { GRID_AUXILIARY_TOP_LEVEL_NAMES } from "../src/grid/GridTemplate";

describe("standard grid occupancy", () => {
  it("keeps every auxiliary top-level exclusion in one shared configuration", () => {
    expect(GRID_AUXILIARY_TOP_LEVEL_NAMES).toEqual([
      "棋子go｜标准网格画布数据",
      "__GRID__",
      "__BACKGROUND__",
      "__NOTES__",
      "__REFERENCES__",
      "__ARCHIVE__"
    ]);
  });

  it("scans only non-auxiliary top-level bounds and keeps hidden design layers", () => {
    const scan = scanGridLayerSnapshots(41, [
      {
        id: 1,
        name: "棋子go｜标准网格画布数据",
        visible: false,
        boundsNoEffects: { left: 4, top: 4, right: 148, bottom: 148 }
      },
      {
        id: 2,
        name: "__ARCHIVE__",
        visible: false,
        boundsNoEffects: { left: 152, top: 4, right: 296, bottom: 148 }
      },
      {
        id: 3,
        name: "隐藏旧设计",
        visible: false,
        boundsNoEffects: { left: 152, top: 4, right: 296, bottom: 148 }
      }
    ], undefined, () => 10);

    expect(scan.scannedTopLevelLayerCount).toBe(1);
    expect(Array.from(scan.occupiedSlots)).toEqual(["R01C02"]);
    expect(scan.slotLayerIds.get("R01C02")).toEqual([3]);
  });

  it("ignores a full-canvas grid backdrop even when it has a generic Photoshop name", () => {
    const scan = scanGridLayerSnapshots(42, [
      {
        id: 10,
        name: "图层 3 拷贝 4",
        visible: true,
        boundsNoEffects: { left: 0, top: 0, right: 1780, bottom: 1188 }
      },
      {
        id: 11,
        name: "棋子",
        visible: true,
        boundsNoEffects: { left: 4, top: 4, right: 148, bottom: 148 }
      }
    ], undefined, () => 20);

    expect(scan.scannedTopLevelLayerCount).toBe(1);
    expect(Array.from(scan.occupiedSlots)).toEqual(["R01C01"]);
    expect(scan.slotLayerIds.get("R01C01")).toEqual([11]);
  });

  it("only treats bounds covering the entire canvas as a backdrop", () => {
    expect(isGridCanvasBackdropBounds({ left: 0, top: 0, right: 1780, bottom: 1188 })).toBe(true);
    expect(isGridCanvasBackdropBounds({ left: -20, top: -20, right: 1800, bottom: 1200 })).toBe(true);
    expect(isGridCanvasBackdropBounds({ left: 4, top: 4, right: 1776, bottom: 1184 })).toBe(false);
    expect(isGridCanvasBackdropBounds({ left: 4, top: 4, right: 148, bottom: 148 })).toBe(false);
  });
});
