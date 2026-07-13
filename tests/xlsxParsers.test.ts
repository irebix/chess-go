import { describe, expect, it } from "vitest";
import { parseDrawing } from "../src/infrastructure/xlsx/DrawingParser";
import { parseSharedStrings } from "../src/infrastructure/xlsx/SharedStringsParser";
import { parseWorksheet } from "../src/infrastructure/xlsx/SheetParser";

describe("XLSX XML parsers", () => {
  it("preserves plain, rich-text and empty shared strings", () => {
    const xml = `
      <sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <si><t>中文</t></si>
        <si><r><t>Rich </t></r><r><rPr><b/></rPr><t>Text</t></r></si>
        <si><t></t></si>
      </sst>
    `;

    expect(parseSharedStrings(xml)).toEqual(["中文", "Rich Text", ""]);
  });

  it("parses inline strings, booleans and cached formula values", () => {
    const xml = `
      <worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
        <sheetData>
          <row r="2">
            <c r="A2" t="inlineStr"><is><r><t>内联</t></r><r><t>文本</t></r></is></c>
            <c r="B2" t="b"><v>1</v></c>
            <c r="C2"><f>1+1</f><v>2</v></c>
            <c r="D2"/>
          </row>
        </sheetData>
        <mergeCells count="1"><mergeCell ref="A2:A5"/></mergeCells>
      </worksheet>
    `;

    const parsed = parseWorksheet(xml, []);
    expect(parsed.cells).toEqual([
      { address: "A2", row: 2, col: 1, value: "内联文本", rawType: "inlineStr" },
      { address: "B2", row: 2, col: 2, value: true, rawType: "b" },
      { address: "C2", row: 2, col: 3, value: "2", rawType: undefined },
      { address: "D2", row: 2, col: 4, value: null, rawType: undefined }
    ]);
    expect(parsed.mergedCells).toEqual([
      { ref: "A2:A5", startRow: 2, startCol: 1, endRow: 5, endCol: 1 }
    ]);
  });

  it("rejects an image anchor without explicit coordinates", () => {
    const drawingXml = `
      <xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"
        xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"
        xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
        <xdr:oneCellAnchor>
          <xdr:from><xdr:col>0</xdr:col></xdr:from>
          <xdr:pic>
            <xdr:nvPicPr><xdr:cNvPr id="1"/></xdr:nvPicPr>
            <xdr:blipFill><a:blip r:embed="rId1"/></xdr:blipFill>
          </xdr:pic>
        </xdr:oneCellAnchor>
      </xdr:wsDr>
    `;
    const relationshipsXml = `
      <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="image" Target="media/image1.png"/>
      </Relationships>
    `;

    expect(() => parseDrawing(drawingXml, relationshipsXml, "xl/drawings/drawing1.xml")).toThrow(
      "oneCell anchor 1 缺少有效 row 坐标"
    );
  });
});
