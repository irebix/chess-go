import type { ParsedSheet, SheetDescriptor, SourceFileInfo, WorkbookIndex } from "../../domain/models";
import { parseDrawing } from "./DrawingParser";
import { relationshipEntryFor, parseRelationships } from "./RelationshipResolver";
import { parseSharedStrings } from "./SharedStringsParser";
import { parseWorksheet } from "./SheetParser";
import { parseWorkbook } from "./WorkbookParser";
import { XlsxArchive } from "./XlsxArchive";

export class XlsxReader {
  private sharedStringsCache?: string[];

  private constructor(
    readonly archive: XlsxArchive,
    readonly index: WorkbookIndex
  ) {}

  static async open(input: ArrayBuffer | Uint8Array, source: SourceFileInfo): Promise<XlsxReader> {
    const archive = await XlsxArchive.open(input);
    const workbookXml = await archive.readText("xl/workbook.xml");
    const relationshipsXml = await archive.readText("xl/_rels/workbook.xml.rels");
    const parsed = parseWorkbook(workbookXml, relationshipsXml);
    return new XlsxReader(archive, { source, ...parsed });
  }

  async parseSheet(descriptor: SheetDescriptor): Promise<ParsedSheet> {
    const sharedStrings = await this.getSharedStrings();
    const sheetXml = await this.archive.readText(descriptor.xmlEntry);
    const parsedWorksheet = parseWorksheet(sheetXml, sharedStrings);
    const sheetRelationshipsEntry = relationshipEntryFor(descriptor.xmlEntry);
    const images = [];

    if (parsedWorksheet.drawingRelationshipIds.length > 0 && !this.archive.has(sheetRelationshipsEntry)) {
      throw new Error(`工作表 ${descriptor.name} 声明了 drawing，但缺少 relationships：${sheetRelationshipsEntry}`);
    }

    if (this.archive.has(sheetRelationshipsEntry)) {
      const relationshipsXml = await this.archive.readText(sheetRelationshipsEntry);
      const relations = parseRelationships(relationshipsXml, descriptor.xmlEntry);
      for (const drawingRelationshipId of parsedWorksheet.drawingRelationshipIds) {
        const drawingRelation = relations.find((relation) => relation.id === drawingRelationshipId);
        if (!drawingRelation) throw new Error(`工作表 ${descriptor.name} 缺少 drawing relationship ${drawingRelationshipId}`);
        const drawingEntry = drawingRelation.archiveEntry;
        const drawingRelsEntry = relationshipEntryFor(drawingEntry);
        const drawingXml = await this.archive.readText(drawingEntry);
        if (!this.archive.has(drawingRelsEntry)) {
          try {
            images.push(...parseDrawing(drawingXml, EMPTY_RELATIONSHIPS_XML, drawingEntry));
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error);
            throw new Error(`drawing ${drawingEntry} 缺少 relationships：${drawingRelsEntry}（${detail}）`);
          }
          continue;
        }
        images.push(
          ...parseDrawing(
            drawingXml,
            await this.archive.readText(drawingRelsEntry),
            drawingEntry
          )
        );
      }
    }

    return { descriptor, cells: parsedWorksheet.cells, images, mergedCells: parsedWorksheet.mergedCells };
  }

  private async getSharedStrings(): Promise<string[]> {
    if (this.sharedStringsCache) return this.sharedStringsCache;
    const entry = this.index.sharedStringsEntry;
    this.sharedStringsCache = entry && this.archive.has(entry) ? parseSharedStrings(await this.archive.readText(entry)) : [];
    return this.sharedStringsCache;
  }
}

const EMPTY_RELATIONSHIPS_XML =
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships" />';
