import {
  GRID_TABLE_SOURCE_LAYER_NAME,
  GRID_TABLE_SOURCE_PREFIX,
  parseGridTableSourceMetadata,
  serializeGridTableSourceMetadata,
  type GridTableSourceMetadata
} from "./GridTableSourceMetadata";
import { GRID_METADATA_GROUP_NAME } from "./GridTemplate";
import {
  collapseHiddenTextMetadataGroup,
  createHiddenTextMetadataLayer,
  findHiddenTextMetadataEntry,
  findTopLevelLayerByName,
  moveHiddenTextMetadataGroupToBottom,
  updateHiddenTextMetadataLayer,
  type HiddenTextDocumentLike
} from "../photoshop/hiddenTextMetadata";

export type GridTableSourceMetadataStoreState =
  | { status: "valid"; metadata: GridTableSourceMetadata; layerId: number; groupId: number }
  | { status: "missing" }
  | { status: "invalid"; reason: string };

const GRID_TABLE_SOURCE_SPEC = {
  groupName: GRID_METADATA_GROUP_NAME,
  layerName: GRID_TABLE_SOURCE_LAYER_NAME,
  contentPrefix: GRID_TABLE_SOURCE_PREFIX
} as const;

export function readGridTableSourceMetadataStore(
  document: HiddenTextDocumentLike
): GridTableSourceMetadataStoreState {
  const group = findTopLevelLayerByName(document, GRID_METADATA_GROUP_NAME);
  if (!group) return { status: "missing" };
  const entry = findHiddenTextMetadataEntry(document, GRID_TABLE_SOURCE_SPEC);
  if (!entry) return { status: "missing" };
  const metadata = parseGridTableSourceMetadata(entry.contents);
  return metadata
    ? { status: "valid", metadata, layerId: entry.layer.id, groupId: entry.group.id }
    : { status: "invalid", reason: "表格网格隐藏数据损坏。" };
}

export async function writeGridTableSourceMetadataStore(
  document: HiddenTextDocumentLike,
  metadata: GridTableSourceMetadata
): Promise<GridTableSourceMetadata> {
  const group = findTopLevelLayerByName(document, GRID_METADATA_GROUP_NAME);
  if (!group) throw new Error("标准网格缺少隐藏数据组。");
  const contents = serializeGridTableSourceMetadata(metadata);
  const existing = findHiddenTextMetadataEntry(document, GRID_TABLE_SOURCE_SPEC);
  const layer = existing?.layer
    ?? await createHiddenTextMetadataLayer(
      document,
      group,
      GRID_TABLE_SOURCE_SPEC,
      contents
    );
  updateHiddenTextMetadataLayer(layer, GRID_TABLE_SOURCE_SPEC, contents);
  layer.visible = false;
  group.visible = false;
  moveHiddenTextMetadataGroupToBottom(document, group);
  await collapseHiddenTextMetadataGroup(group.id);

  const verified = readGridTableSourceMetadataStore(document);
  if (verified.status !== "valid") {
    throw new Error(
      verified.status === "invalid"
        ? verified.reason
        : "表格网格隐藏数据写入后无法重新读取。"
    );
  }
  return verified.metadata;
}
