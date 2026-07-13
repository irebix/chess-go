import type { ImageAnchor } from "../../domain/models";
import { parseRelationships } from "./RelationshipResolver";
import { asArray, attribute, child, isRecord, parseXml, textValue } from "./xml";

export function parseDrawing(
  drawingXml: string,
  drawingRelationshipsXml: string,
  drawingEntry: string
): ImageAnchor[] {
  const relations = parseRelationships(drawingRelationshipsXml, drawingEntry);
  const relationMap = new Map(relations.map((relation) => [relation.id, relation]));
  const document = parseXml(drawingXml);
  const root = child(document, "wsDr");
  return [
    ...parseAnchors(asArray(child(root, "oneCellAnchor")), "oneCell", relationMap),
    ...parseAnchors(asArray(child(root, "twoCellAnchor")), "twoCell", relationMap)
  ];
}

function parseAnchors(
  nodes: unknown[],
  anchorType: "oneCell" | "twoCell",
  relationMap: Map<string, { archiveEntry: string }>
): ImageAnchor[] {
  return nodes.flatMap((node, index) => {
    if (!isRecord(node)) return [];
    const from = child(node, "from");
    const fromCol = parseZeroBasedCoordinate(from, "col", `${anchorType} anchor ${index + 1}`) + 1;
    const fromRow = parseZeroBasedCoordinate(from, "row", `${anchorType} anchor ${index + 1}`) + 1;
    const picture = child(node, "pic");
    const relationshipId = attribute(child(child(picture, "blipFill"), "blip"), "embed");
    if (!relationshipId) return [];
    const relation = relationMap.get(relationshipId);
    if (!relation) throw new Error(`drawing 图片缺少 relationship：${relationshipId}`);
    const to = child(node, "to");
    const toRow =
      anchorType === "twoCell" ? parseZeroBasedCoordinate(to, "row", `twoCell anchor ${index + 1}`) + 1 : undefined;
    const toCol =
      anchorType === "twoCell" ? parseZeroBasedCoordinate(to, "col", `twoCell anchor ${index + 1}`) + 1 : undefined;
    const extension = child(node, "ext");
    const id = attribute(child(child(picture, "nvPicPr"), "cNvPr"), "id") ?? `${relationshipId}-${index}`;
    const lowerEntry = relation.archiveEntry.toLowerCase();
    const mediaType = lowerEntry.endsWith(".png")
      ? "png"
      : lowerEntry.endsWith(".jpg") || lowerEntry.endsWith(".jpeg")
        ? "jpeg"
        : "other";
    return [
      {
        id: `${relationshipId}:${id}:${fromRow}:${fromCol}`,
        anchorType,
        fromRow,
        fromCol,
        toRow,
        toCol,
        relationshipId,
        archiveEntry: relation.archiveEntry,
        mediaType,
        widthEmu: numberAttribute(extension, "cx"),
        heightEmu: numberAttribute(extension, "cy")
      } satisfies ImageAnchor
    ];
  });
}

function parseZeroBasedCoordinate(node: unknown, key: "row" | "col", context: string): number {
  const raw = textValue(child(node, key));
  if (!/^\d+$/.test(raw)) throw new Error(`${context} 缺少有效 ${key} 坐标。`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) throw new Error(`${context} 的 ${key} 坐标超出范围。`);
  return value;
}

function numberAttribute(node: unknown, key: string): number | undefined {
  const value = attribute(node, key);
  const number = value === undefined ? Number.NaN : Number(value);
  return Number.isFinite(number) ? number : undefined;
}
