import {
  GRID_PREFIX,
  parseGridMetadata,
  serializeGridMetadata,
  standardGridMetadata,
  validateGridMetadata,
  type GridMetadata,
  type GridMetadataParseResult
} from "./GridMetadata";
import {
  GRID_METADATA_GROUP_NAME,
  GRID_METADATA_LAYER_NAME,
  STANDARD_GRID_TEMPLATE
} from "./GridTemplate";
import {
  collapseHiddenTextMetadataGroup,
  collectionValues,
  createHiddenTextMetadataLayer,
  ensureHiddenTextMetadataGroup,
  findHiddenTextMetadataEntry,
  findTopLevelLayerByName,
  moveHiddenTextMetadataGroupToBottom,
  updateHiddenTextMetadataLayer,
  type HiddenTextDocumentLike,
  type HiddenTextLayerLike
} from "../photoshop/hiddenTextMetadata";

export interface GridMetadataDocumentLike extends HiddenTextDocumentLike {
  id: number;
  width: number | { value?: number };
  height: number | { value?: number };
  artboards?: { length: number };
}

export type GridMetadataStoreState =
  | { status: "valid"; metadata: GridMetadata; layerId: number; groupId: number }
  | { status: "missing" }
  | { status: "unsupported-version"; version: number }
  | { status: "invalid"; reason: string };

const GRID_METADATA_SPEC = {
  groupName: GRID_METADATA_GROUP_NAME,
  layerName: GRID_METADATA_LAYER_NAME,
  // A future-version prefix must still be discovered so it is never overwritten.
  contentPrefix: "chess-go-grid-v"
} as const;

export function documentCanvasSize(document: GridMetadataDocumentLike): {
  width: number;
  height: number;
} {
  return {
    width: numericDimension(document.width),
    height: numericDimension(document.height)
  };
}

export function documentHasArtboards(document: GridMetadataDocumentLike): boolean {
  return Number(document.artboards?.length ?? 0) > 0;
}

export function readGridMetadataStore(document: GridMetadataDocumentLike): GridMetadataStoreState {
  const group = findTopLevelLayerByName(document, GRID_METADATA_GROUP_NAME);
  if (!group) return { status: "missing" };
  const entry = findHiddenTextMetadataEntry(document, GRID_METADATA_SPEC);
  if (!entry) return { status: "invalid", reason: "网格配置组中缺少配置文本层。" };
  const parsed = parseGridMetadata(entry.contents);
  if (parsed.status === "valid") {
    try {
      if (documentHasArtboards(document)) {
        throw new Error("含 Photoshop 画板的文档不能作为标准网格画布。");
      }
      return {
        status: "valid",
        metadata: validateGridMetadata(parsed.metadata, documentCanvasSize(document)),
        layerId: entry.layer.id,
        groupId: entry.group.id
      };
    } catch (error) {
      return {
        status: "invalid",
        reason: error instanceof Error ? error.message : "网格配置无效。"
      };
    }
  }
  return storeStateFromParseResult(parsed);
}

export async function initializeGridMetadataStore(
  document: GridMetadataDocumentLike
): Promise<GridMetadata> {
  if (documentHasArtboards(document)) throw new Error("含 Photoshop 画板的文档不能初始化标准网格。");
  const canvas = documentCanvasSize(document);
  if (
    canvas.width !== STANDARD_GRID_TEMPLATE.canvas.width ||
    canvas.height !== STANDARD_GRID_TEMPLATE.canvas.height
  ) {
    throw new Error("只有 1780 × 1188 px 的非画板文档可以初始化标准网格。");
  }
  const before = readGridMetadataStore(document);
  if (before.status === "unsupported-version") {
    throw new Error(`当前 PSD 使用网格数据 v${before.version}；请升级棋子go 后再操作。`);
  }
  if (before.status === "valid") return before.metadata;

  const contents = serializeGridMetadata();
  const parsedBeforeWrite = parseGridMetadata(contents);
  if (parsedBeforeWrite.status !== "valid") throw new Error("棋子go 未能生成有效的网格配置。");
  const group = await ensureHiddenTextMetadataGroup(document, GRID_METADATA_SPEC);
  let layer = recoverableGridTextLayer(document, group);
  if (layer) updateHiddenTextMetadataLayer(layer, GRID_METADATA_SPEC, contents);
  else layer = await createHiddenTextMetadataLayer(document, group, GRID_METADATA_SPEC, contents);
  layer.visible = false;
  group.visible = false;
  moveHiddenTextMetadataGroupToBottom(document, group);
  layer.visible = false;
  group.visible = false;
  await collapseHiddenTextMetadataGroup(group.id);

  const verified = readGridMetadataStore(document);
  if (verified.status !== "valid") {
    throw new Error(`网格配置写入后校验失败：${metadataStateReason(verified)}`);
  }
  return verified.metadata;
}

export function isExactStandardGridCanvasSize(document: GridMetadataDocumentLike): boolean {
  const size = documentCanvasSize(document);
  return size.width === STANDARD_GRID_TEMPLATE.canvas.width
    && size.height === STANDARD_GRID_TEMPLATE.canvas.height;
}

function recoverableGridTextLayer(
  document: GridMetadataDocumentLike,
  group: HiddenTextLayerLike
): HiddenTextLayerLike | undefined {
  return findHiddenTextMetadataEntry(document, GRID_METADATA_SPEC)?.layer
    ?? collectionValues(group.layers).find((layer) => Boolean(layer.textItem));
}

function storeStateFromParseResult(parsed: GridMetadataParseResult): GridMetadataStoreState {
  if (parsed.status === "unsupported-version") return parsed;
  if (parsed.status === "invalid") return parsed;
  return {
    status: "invalid",
    reason: parsed.status === "missing"
      ? `网格配置层不包含 ${GRID_PREFIX} 数据。`
      : "网格配置无效。"
  };
}

function metadataStateReason(state: GridMetadataStoreState): string {
  if (state.status === "invalid") return state.reason;
  if (state.status === "unsupported-version") return `不支持 v${state.version}`;
  return state.status === "missing" ? "配置缺失" : "未知错误";
}

function numericDimension(value: number | { value?: number }): number {
  const numeric = typeof value === "number" ? value : Number(value?.value);
  return Number.isFinite(numeric) ? numeric : Number.NaN;
}
