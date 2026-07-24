import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("table grid PSD generator", () => {
  it("plans chains before choosing one save target and preserves volume boundaries", () => {
    const source = readFileSync(
      resolve("src/photoshop/TableGridDocumentGenerator.ts"),
      "utf8"
    );
    const plan = source.indexOf("planTableGridVolumes(");
    const selectOutput = source.indexOf("await selectPsdOutput(", plan);
    const modal = source.indexOf("await core.executeAsModal(", selectOutput);
    const volumeLoop = source.indexOf("for (let volumeIndex = 0;", modal);
    const foundation = source.indexOf("await createStandardGridDocumentFoundation(", volumeLoop);
    const save = source.indexOf("await document.saveAs.psd(", foundation);
    expect(plan).toBeGreaterThan(-1);
    expect(selectOutput).toBeGreaterThan(plan);
    expect(source.match(/await selectPsdOutput\(/g)).toHaveLength(1);
    expect(modal).toBeGreaterThan(selectOutput);
    expect(volumeLoop).toBeGreaterThan(modal);
    expect(foundation).toBeGreaterThan(volumeLoop);
    expect(save).toBeGreaterThan(foundation);
    expect(source).toContain("assertSubsequentOutputNamesAvailable");
    expect(source).toContain("cleanupIncompleteOutputs");
  });

  it("uses exact chain names, deterministic layer order and stable hidden identities", () => {
    const source = readFileSync(
      resolve("src/photoshop/TableGridDocumentGenerator.ts"),
      "utf8"
    );
    const metadataStore = readFileSync(
      resolve("src/grid/GridTableSourceMetadataStore.ts"),
      "utf8"
    );
    const canvasService = readFileSync(
      resolve("src/photoshop/StandardGridCanvasService.ts"),
      "utf8"
    );
    expect(source).toContain("name: chain.group.label");
    expect(source).toContain("groupLayer.name = chain.group.label");
    expect(source).toContain("orderChainGroupsAboveBackground");
    expect(source).toContain("constants.ElementPlacement.PLACEBEFORE");
    expect(source).toContain("placedLayer.name = item.assetCode");
    expect(source).toContain("constants.ElementPlacement.PLACEINSIDE");
    expect(source).toContain("constants.ElementPlacement.PLACEAFTER");
    expect(source).toContain("chainId: chain.group.id");
    expect(source).toContain("groupLayerId: groupLayer.id");
    expect(source).toContain("imageLayerId");
    expect(source).toContain("await writeGridTableSourceMetadataStore(");
    expect(metadataStore).toContain("GRID_METADATA_GROUP_NAME");
    expect(metadataStore).toContain("collapseHiddenTextMetadataGroup");
    expect(canvasService).toContain("readGridTableSourceMetadataStore(document)");
    expect(canvasService).toContain("gridSlotAt(chain.row, column).id");
  });

  it("exposes separate empty-grid and table-grid branches in Generate PSD", () => {
    const app = readFileSync(resolve("src/app/App.tsx"), "utf8");
    expect(app).toContain("生成空网格画布");
    expect(app).toContain("从表格生成网格 PSD（");
    expect(app).toContain("一条链占一整行");
    expect(app).toContain("超过 8 条链自动分卷");
    expect(app).toContain("handleGenerateTableGrid");
    expect(app).toContain('phase === "generatingTableGrid"');
  });
});
