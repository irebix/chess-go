import { normalizeArchivePath } from "./paths";
import { asArray, attribute, child, isRecord, parseXml } from "./xml";

export interface Relationship {
  id: string;
  type: string;
  target: string;
  archiveEntry: string;
}

export function parseRelationships(xml: string, ownerEntry: string): Relationship[] {
  const document = parseXml(xml);
  const root = child(document, "Relationships");
  const relationships = asArray(child(root, "Relationship"));
  return relationships.flatMap((node) => {
    if (!isRecord(node)) return [];
    const id = attribute(node, "Id") ?? attribute(node, "id");
    const type = attribute(node, "Type") ?? "";
    const target = attribute(node, "Target");
    if (!id || !target) return [];
    return [{ id, type, target, archiveEntry: normalizeArchivePath(ownerEntry, target) }];
  });
}

export function relationshipEntryFor(ownerEntry: string): string {
  const normalized = ownerEntry.replace(/\\/g, "/");
  const slash = normalized.lastIndexOf("/");
  const directory = slash >= 0 ? normalized.slice(0, slash) : "";
  const fileName = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  return `${directory ? `${directory}/` : ""}_rels/${fileName}.rels`;
}
