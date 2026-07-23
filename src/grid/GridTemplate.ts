export const STANDARD_GRID_TEMPLATE_ID = "grid-12x8-cell144-gap4-margin4-v1";

export interface GridTemplate {
  templateId: string;
  canvas: {
    width: number;
    height: number;
  };
  grid: {
    columns: number;
    rows: number;
    cellWidth: number;
    cellHeight: number;
    gapX: number;
    gapY: number;
    marginX: number;
    marginY: number;
  };
}

export const STANDARD_GRID_TEMPLATE: GridTemplate = Object.freeze({
  templateId: STANDARD_GRID_TEMPLATE_ID,
  canvas: Object.freeze({ width: 1780, height: 1188 }),
  grid: Object.freeze({
    columns: 12,
    rows: 8,
    cellWidth: 144,
    cellHeight: 144,
    gapX: 4,
    gapY: 4,
    marginX: 4,
    marginY: 4
  })
});

export const GRID_METADATA_GROUP_NAME = "棋子go｜标准网格画布数据";
export const GRID_METADATA_LAYER_NAME = "棋子go｜网格配置（请勿删除）";
export const GRID_BACKGROUND_LAYER_NAME = "__BACKGROUND__";

export const GRID_AUXILIARY_TOP_LEVEL_NAMES = Object.freeze([
  GRID_METADATA_GROUP_NAME,
  "__GRID__",
  GRID_BACKGROUND_LAYER_NAME,
  "__NOTES__",
  "__REFERENCES__",
  "__ARCHIVE__"
]);

export const GRID_INTERSECTION_EPSILON = 0.5;
export const GRID_OCCUPANCY_MIN_OVERLAP_RATIO = 0.2;

export function gridPitchX(template: GridTemplate = STANDARD_GRID_TEMPLATE): number {
  return template.grid.cellWidth + template.grid.gapX;
}

export function gridPitchY(template: GridTemplate = STANDARD_GRID_TEMPLATE): number {
  return template.grid.cellHeight + template.grid.gapY;
}

export function gridCanvasSize(template: GridTemplate = STANDARD_GRID_TEMPLATE): {
  width: number;
  height: number;
} {
  const { columns, rows, cellWidth, cellHeight, gapX, gapY, marginX, marginY } = template.grid;
  return {
    width: columns * cellWidth + (columns - 1) * gapX + marginX * 2,
    height: rows * cellHeight + (rows - 1) * gapY + marginY * 2
  };
}
