import { decodeUtf8Base64Url, encodeUtf8Base64Url } from "../domain/base64UrlCodec";
import { STANDARD_GRID_TEMPLATE } from "./GridTemplate";

export const GRID_TABLE_SOURCE_SCHEMA = "chess-go-grid-table-source";
export const GRID_TABLE_SOURCE_VERSION = 1;
export const GRID_TABLE_SOURCE_PREFIX = "chess-go-grid-table-source-v1:";
export const GRID_TABLE_SOURCE_LAYER_NAME = "棋子go｜表格网格数据（请勿删除）";

export interface GridTableSourceItem {
  assetCode: string;
  name?: string;
  sourceOrder: number;
  column: number;
  imageLayerId?: number;
}

export interface GridTableSourceChain {
  chainId: string;
  label: string;
  sourceCell: string;
  row: number;
  groupLayerId: number;
  items: GridTableSourceItem[];
}

export interface GridTableSourceMetadata {
  schema: typeof GRID_TABLE_SOURCE_SCHEMA;
  version: typeof GRID_TABLE_SOURCE_VERSION;
  workbookName: string;
  sheetName: string;
  volumeNumber: number;
  volumeCount: number;
  chains: GridTableSourceChain[];
}

type CompactItem = [string, string, number, number, number];
type CompactChain = [string, string, string, number, number, CompactItem[]];

interface CompactGridTableSourceMetadata {
  s: string;
  v: number;
  w: string;
  h: string;
  o: [number, number];
  c: CompactChain[];
}

export function serializeGridTableSourceMetadata(metadata: GridTableSourceMetadata): string {
  const validated = validateGridTableSourceMetadata(metadata);
  const compact: CompactGridTableSourceMetadata = {
    s: validated.schema,
    v: validated.version,
    w: validated.workbookName,
    h: validated.sheetName,
    o: [validated.volumeNumber, validated.volumeCount],
    c: validated.chains.map((chain) => [
      chain.chainId,
      chain.label,
      chain.sourceCell,
      chain.row,
      chain.groupLayerId,
      chain.items.map((item) => [
        item.assetCode,
        item.name ?? "",
        item.sourceOrder,
        item.column,
        item.imageLayerId ?? 0
      ])
    ])
  };
  return `${GRID_TABLE_SOURCE_PREFIX}${encodeUtf8Base64Url(JSON.stringify(compact))}`;
}

export function parseGridTableSourceMetadata(value: string): GridTableSourceMetadata | undefined {
  if (!value.startsWith(GRID_TABLE_SOURCE_PREFIX)) return undefined;
  try {
    const compact = JSON.parse(
      decodeUtf8Base64Url(value.slice(GRID_TABLE_SOURCE_PREFIX.length).replace(/\s+/g, ""))
    ) as Partial<CompactGridTableSourceMetadata>;
    if (
      compact.s !== GRID_TABLE_SOURCE_SCHEMA
      || compact.v !== GRID_TABLE_SOURCE_VERSION
      || !Array.isArray(compact.o)
      || !Array.isArray(compact.c)
    ) {
      return undefined;
    }
    return validateGridTableSourceMetadata({
      schema: compact.s,
      version: compact.v,
      workbookName: compact.w as string,
      sheetName: compact.h as string,
      volumeNumber: compact.o[0]!,
      volumeCount: compact.o[1]!,
      chains: compact.c.map(expandChain)
    });
  } catch {
    return undefined;
  }
}

export function validateGridTableSourceMetadata(
  metadata: GridTableSourceMetadata
): GridTableSourceMetadata {
  if (
    metadata.schema !== GRID_TABLE_SOURCE_SCHEMA
    || metadata.version !== GRID_TABLE_SOURCE_VERSION
  ) {
    throw new Error("表格网格数据版本无效。");
  }
  if (!metadata.workbookName?.trim() || !metadata.sheetName?.trim()) {
    throw new Error("表格网格缺少工作簿或工作表名称。");
  }
  if (
    !positiveInteger(metadata.volumeNumber)
    || !positiveInteger(metadata.volumeCount)
    || metadata.volumeNumber > metadata.volumeCount
  ) {
    throw new Error("表格网格分卷信息无效。");
  }
  if (!metadata.chains.length || metadata.chains.length > STANDARD_GRID_TEMPLATE.grid.rows) {
    throw new Error("表格网格棋子链数量无效。");
  }

  const chainIds = new Set<string>();
  const groupLayerIds = new Set<number>();
  const rows = new Set<number>();
  const imageLayerIds = new Set<number>();
  const chains = metadata.chains.map((chain) => {
    if (
      !chain.chainId?.trim()
      || !chain.label?.trim()
      || !chain.sourceCell?.trim()
      || !nonNegativeInteger(chain.row)
      || chain.row >= STANDARD_GRID_TEMPLATE.grid.rows
      || !positiveInteger(chain.groupLayerId)
      || !chain.items.length
      || chain.items.length > STANDARD_GRID_TEMPLATE.grid.columns
      || chainIds.has(chain.chainId)
      || groupLayerIds.has(chain.groupLayerId)
      || rows.has(chain.row)
    ) {
      throw new Error("表格网格棋子链数据无效或重复。");
    }
    chainIds.add(chain.chainId);
    groupLayerIds.add(chain.groupLayerId);
    rows.add(chain.row);
    const columns = new Set<number>();
    const items = chain.items.map((item) => {
      if (
        !item.assetCode?.trim()
        || !nonNegativeInteger(item.sourceOrder)
        || !nonNegativeInteger(item.column)
        || item.column >= STANDARD_GRID_TEMPLATE.grid.columns
        || columns.has(item.column)
        || (item.name !== undefined && typeof item.name !== "string")
        || (
          item.imageLayerId !== undefined
          && (!positiveInteger(item.imageLayerId) || imageLayerIds.has(item.imageLayerId))
        )
      ) {
        throw new Error("表格网格棋子数据无效或重复。");
      }
      columns.add(item.column);
      if (item.imageLayerId !== undefined) imageLayerIds.add(item.imageLayerId);
      const name = item.name?.trim();
      return {
        assetCode: item.assetCode.trim(),
        ...(name ? { name } : {}),
        sourceOrder: item.sourceOrder,
        column: item.column,
        ...(item.imageLayerId !== undefined ? { imageLayerId: item.imageLayerId } : {})
      };
    });
    return {
      chainId: chain.chainId,
      label: chain.label.trim(),
      sourceCell: chain.sourceCell.trim(),
      row: chain.row,
      groupLayerId: chain.groupLayerId,
      items
    };
  });

  return {
    ...metadata,
    workbookName: metadata.workbookName.trim(),
    sheetName: metadata.sheetName.trim(),
    chains
  };
}

function expandChain(value: CompactChain): GridTableSourceChain {
  if (!Array.isArray(value) || value.length !== 6 || !Array.isArray(value[5])) {
    throw new Error("表格网格棋子链字段缺失。");
  }
  return {
    chainId: value[0],
    label: value[1],
    sourceCell: value[2],
    row: value[3],
    groupLayerId: value[4],
    items: value[5].map(expandItem)
  };
}

function expandItem(value: CompactItem): GridTableSourceItem {
  if (!Array.isArray(value) || value.length !== 5) {
    throw new Error("表格网格棋子字段缺失。");
  }
  return {
    assetCode: value[0],
    ...(value[1] ? { name: value[1] } : {}),
    sourceOrder: value[2],
    column: value[3],
    ...(value[4] ? { imageLayerId: value[4] } : {})
  };
}

function positiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}
