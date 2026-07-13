import type { SheetDescriptor } from "../../domain/models";
import { parseRelationships } from "./RelationshipResolver";
import { asArray, attribute, child, isRecord, parseXml } from "./xml";

export interface ParsedWorkbook {
  sheets: SheetDescriptor[];
  sharedStringsEntry?: string;
}

export function parseWorkbook(workbookXml: string, relationshipsXml: string): ParsedWorkbook {
  const relations = parseRelationships(relationshipsXml, "xl/workbook.xml");
  const relationMap = new Map(relations.map((relation) => [relation.id, relation]));
  const document = parseXml(workbookXml);
  const workbook = child(document, "workbook");
  const sheetNodes = asArray(child(child(workbook, "sheets"), "sheet"));
  const sheets = sheetNodes.flatMap((node, order) => {
    if (!isRecord(node)) return [];
    const name = attribute(node, "name");
    const sheetId = attribute(node, "sheetId");
    const relationshipId = attribute(node, "id");
    if (!name || !sheetId || !relationshipId) return [];
    const relation = relationMap.get(relationshipId);
    if (!relation) throw new Error(`工作表 ${name} 缺少 relationship ${relationshipId}`);
    const rawState = attribute(node, "state");
    const state: SheetDescriptor["state"] =
      rawState === "hidden" || rawState === "veryHidden" ? rawState : "visible";
    return [{ name, sheetId, relationshipId, xmlEntry: relation.archiveEntry, state, order }];
  });
  const sharedStringsEntry = relations.find((relation) => relation.type.endsWith("/sharedStrings"))?.archiveEntry;
  return { sheets, sharedStringsEntry };
}
