import { decodeUtf8Base64Url, encodeUtf8Base64Url } from "../domain/base64UrlCodec";
import {
  STANDARD_GRID_TEMPLATE,
  STANDARD_GRID_TEMPLATE_ID,
  gridCanvasSize
} from "./GridTemplate";

export const GRID_SCHEMA = "chess-go-grid";
export const GRID_VERSION = 1;
export const GRID_PREFIX = "chess-go-grid-v1:";

export interface GridMetadata {
  schema: typeof GRID_SCHEMA;
  version: typeof GRID_VERSION;
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

interface CompactGridMetadata {
  s: string;
  v: number;
  t: string;
  c: [number, number];
  g: [number, number, number, number, number, number, number, number];
}

export type GridMetadataParseResult =
  | { status: "valid"; metadata: GridMetadata }
  | { status: "missing" }
  | { status: "unsupported-version"; version: number }
  | { status: "invalid"; reason: string };

export function standardGridMetadata(): GridMetadata {
  return {
    schema: GRID_SCHEMA,
    version: GRID_VERSION,
    templateId: STANDARD_GRID_TEMPLATE_ID,
    canvas: { ...STANDARD_GRID_TEMPLATE.canvas },
    grid: { ...STANDARD_GRID_TEMPLATE.grid }
  };
}

export function serializeGridMetadata(metadata: GridMetadata = standardGridMetadata()): string {
  const validated = validateGridMetadata(metadata);
  const compact: CompactGridMetadata = {
    s: validated.schema,
    v: validated.version,
    t: validated.templateId,
    c: [validated.canvas.width, validated.canvas.height],
    g: [
      validated.grid.columns,
      validated.grid.rows,
      validated.grid.cellWidth,
      validated.grid.cellHeight,
      validated.grid.gapX,
      validated.grid.gapY,
      validated.grid.marginX,
      validated.grid.marginY
    ]
  };
  return `${GRID_PREFIX}${encodeUtf8Base64Url(JSON.stringify(compact))}`;
}

export function parseGridMetadata(value: string): GridMetadataParseResult {
  if (!value.startsWith("chess-go-grid-v")) return { status: "missing" };
  const prefixMatch = /^chess-go-grid-v(\d+):/.exec(value);
  if (!prefixMatch) return { status: "invalid", reason: "网格数据前缀无效。" };
  const prefixVersion = Number(prefixMatch[1]);
  if (prefixVersion > GRID_VERSION) return { status: "unsupported-version", version: prefixVersion };
  if (prefixVersion !== GRID_VERSION || !value.startsWith(GRID_PREFIX)) {
    return { status: "invalid", reason: "网格数据版本无效。" };
  }
  try {
    const payload = value.slice(GRID_PREFIX.length).replace(/\s+/g, "");
    if (!payload) return { status: "invalid", reason: "网格数据为空。" };
    const compact = JSON.parse(decodeUtf8Base64Url(payload)) as Partial<CompactGridMetadata>;
    const version = Number(compact.v);
    if (version > GRID_VERSION) return { status: "unsupported-version", version };
    if (!Array.isArray(compact.c) || !Array.isArray(compact.g)) {
      return { status: "invalid", reason: "网格数据字段缺失。" };
    }
    const metadata = validateGridMetadata({
      schema: compact.s as typeof GRID_SCHEMA,
      version: compact.v as typeof GRID_VERSION,
      templateId: compact.t as string,
      canvas: { width: compact.c[0]!, height: compact.c[1]! },
      grid: {
        columns: compact.g[0]!,
        rows: compact.g[1]!,
        cellWidth: compact.g[2]!,
        cellHeight: compact.g[3]!,
        gapX: compact.g[4]!,
        gapY: compact.g[5]!,
        marginX: compact.g[6]!,
        marginY: compact.g[7]!
      }
    });
    return { status: "valid", metadata };
  } catch (error) {
    return {
      status: "invalid",
      reason: error instanceof Error ? error.message : "网格数据损坏。"
    };
  }
}

export function validateGridMetadata(
  metadata: GridMetadata,
  currentCanvas?: { width: number; height: number }
): GridMetadata {
  if (metadata.schema !== GRID_SCHEMA) throw new Error("网格 schema 无效。");
  if (metadata.version !== GRID_VERSION) throw new Error("网格 version 无效。");
  if (metadata.templateId !== STANDARD_GRID_TEMPLATE_ID) throw new Error("网格 templateId 无效。");
  const values = [
    metadata.canvas.width,
    metadata.canvas.height,
    metadata.grid.columns,
    metadata.grid.rows,
    metadata.grid.cellWidth,
    metadata.grid.cellHeight,
    metadata.grid.gapX,
    metadata.grid.gapY,
    metadata.grid.marginX,
    metadata.grid.marginY
  ];
  if (!values.every((value) => Number.isFinite(value) && Number.isInteger(value))) {
    throw new Error("网格尺寸和数量必须为有限整数。");
  }
  if (
    metadata.grid.columns <= 0 || metadata.grid.rows <= 0 ||
    metadata.grid.cellWidth <= 0 || metadata.grid.cellHeight <= 0
  ) {
    throw new Error("网格行列和格子尺寸必须大于 0。");
  }
  if (
    metadata.grid.gapX < 0 || metadata.grid.gapY < 0 ||
    metadata.grid.marginX < 0 || metadata.grid.marginY < 0
  ) {
    throw new Error("网格间距和外边距不得小于 0。");
  }
  const calculated = gridCanvasSize({
    templateId: metadata.templateId,
    canvas: metadata.canvas,
    grid: metadata.grid
  });
  if (
    calculated.width !== STANDARD_GRID_TEMPLATE.canvas.width ||
    calculated.height !== STANDARD_GRID_TEMPLATE.canvas.height ||
    metadata.canvas.width !== calculated.width ||
    metadata.canvas.height !== calculated.height
  ) {
    throw new Error("网格尺寸公式与标准画布不一致。");
  }
  if (
    metadata.grid.columns !== STANDARD_GRID_TEMPLATE.grid.columns ||
    metadata.grid.rows !== STANDARD_GRID_TEMPLATE.grid.rows ||
    metadata.grid.cellWidth !== STANDARD_GRID_TEMPLATE.grid.cellWidth ||
    metadata.grid.cellHeight !== STANDARD_GRID_TEMPLATE.grid.cellHeight ||
    metadata.grid.gapX !== STANDARD_GRID_TEMPLATE.grid.gapX ||
    metadata.grid.gapY !== STANDARD_GRID_TEMPLATE.grid.gapY ||
    metadata.grid.marginX !== STANDARD_GRID_TEMPLATE.grid.marginX ||
    metadata.grid.marginY !== STANDARD_GRID_TEMPLATE.grid.marginY
  ) {
    throw new Error("网格配置不是当前插件支持的标准模板。");
  }
  if (
    currentCanvas &&
    (currentCanvas.width !== metadata.canvas.width || currentCanvas.height !== metadata.canvas.height)
  ) {
    throw new Error("网格配置与当前画布尺寸不一致，已停止自动定位。");
  }
  return {
    ...metadata,
    canvas: { ...metadata.canvas },
    grid: { ...metadata.grid }
  };
}
