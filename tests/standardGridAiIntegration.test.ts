import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("standard grid AI integration", () => {
  it("supports row or single draft insertion while binding one chain to one row", () => {
    const source = readFileSync(resolve("src/app/AiGenerationPanel.tsx"), "utf8");
    const service = readFileSync(resolve("src/photoshop/StandardGridCanvasService.ts"), "utf8");
    expect(source).toContain('currentMode === "STANDARD_GRID"');
    expect(source).toContain("planEmptyGridRow(document)");
    expect(source).toContain("inspectGridDraftBinding(document, selectedGroup.id, chainItems)");
    expect(source).toContain("groupItems.flatMap((currentItem, chainIndex)");
    expect(source).toContain("entry.chainIndex");
    expect(source).toContain("await upsertGridDraftImages(");
    expect(source).toContain('commitGridPlacement("row")');
    expect(source).toContain('commitGridPlacement("single")');
    expect(source).toContain("插入整排");
    expect(source).toContain("插入当前");
    expect(source).toContain("更新整排");
    expect(source).toContain("更新当前");
    expect(source).toContain("error instanceof GridTargetOccupiedError");
    expect(source).toContain("不会另开第二排");
    expect(source).not.toContain("同一条链只绑定这一排；后续候选会更新已有智能对象");
    expect(service).toContain("replacePlacedLayerContentsDescriptor");
    expect(service).toContain("runWithRollbackHistory");
    expect(service).toContain("excludedLayerIds");
    expect(service).toContain("gridDraftTargetIsOccupied(current, targetSlotId");
    expect(service).toContain("current.createLayerGroup({");
    expect(service).toContain("gridDraftGroupName(chainId, chainLabel, row)");
    expect(service).toContain("constants.ElementPlacement.PLACEINSIDE");
    expect(service).toContain("draftGroup.visible = true");
    expect(service).toContain("targetLayer.visible = true");
    expect(service).toContain("reservedSlots: gridDraftReservedSlots(document)");
    expect(source).toContain("selectedGroup.label");
  });

  it("continues candidate generation while the standard-grid document is active", () => {
    const source = readFileSync(resolve("src/app/AiGenerationPanel.tsx"), "utf8");
    const controller = readFileSync(resolve("src/photoshop/referenceViewController.ts"), "utf8");
    expect(source).toContain('placementMode === "STANDARD_GRID"');
    expect(source).toContain("generationContextActive");
    expect(source).toContain('allowInactivePsdSource: placementMode === "STANDARD_GRID"');
    expect(source).toContain("inspectOpenReferenceDocument(reference.documentId)");
    expect(source).not.toContain("!artboardGenerationActive;");
    expect(controller).toContain("export async function inspectOpenReferenceDocument(");
    expect(controller).toContain("app.documents.find((document) => document.id === documentId)");
  });

  it("keeps AI draft visible and rediscovers an open source PSD after reload on a grid canvas", () => {
    const app = readFileSync(resolve("src/app/App.tsx"), "utf8");
    const panel = readFileSync(resolve("src/app/AiGenerationPanel.tsx"), "utf8");
    const controller = readFileSync(resolve("src/photoshop/referenceViewController.ts"), "utf8");
    expect(app).toContain('placementMode === "STANDARD_GRID" || aiPsdReferences.length > 0');
    expect(app).toContain("inspectOpenReferenceDocuments(activePhotoshopDocumentId)");
    expect(app).toContain("if (source) setRetainedAiSourceDocument(source)");
    expect(controller).toContain("export async function inspectOpenReferenceDocuments(");
    expect(panel).toContain("尚未找到 AI初稿来源；请保持来源画板 PSD 打开");
  });

  it("renames the user-facing generation panel to AI draft", () => {
    const source = readFileSync(resolve("src/app/AiGenerationPanel.tsx"), "utf8");
    expect(source).toContain("<span>AI初稿</span>");
    expect(source).toContain('ariaLabel="AI初稿版本"');
    expect(source).not.toContain("<span>AI 生成</span>");
  });

  it("uses UXP-safe flex layout for the row and single insertion buttons", () => {
    const styles = readFileSync(resolve("src/styles.css"), "utf8");
    const actions = styles.slice(styles.indexOf(".ai-grid-placement-actions"));
    expect(actions).toContain("display: flex");
    expect(actions).toContain("flex: 1 1 0");
    expect(actions).not.toContain("display: grid");
  });

  it("distinguishes the clicked candidate from the selected candidate column", () => {
    const source = readFileSync(resolve("src/app/AiGenerationPanel.tsx"), "utf8");
    const styles = readFileSync(resolve("src/styles.css"), "utf8");
    expect(source).toContain("gridCurrentSlotIndex");
    expect(source).toContain("is-grid-current");
    expect(source).toContain("aria-current={currentForGridPlacement ? true : undefined}");
    expect(styles).toContain(".ai-candidate-cell.is-grid-selected");
    expect(styles).toContain(".ai-candidate-cell.is-grid-current");
    expect(styles).toContain("outline: 3px solid #f0b84b");
  });

  it("keeps artboard backfill unchanged behind the placement mode branch", () => {
    const source = readFileSync(resolve("src/app/AiGenerationPanel.tsx"), "utf8");
    const modeBranch = source.indexOf('currentMode === "STANDARD_GRID"');
    const artboardBackfill = source.indexOf("await backfillAiCandidate(", modeBranch);
    expect(modeBranch).toBeGreaterThan(-1);
    expect(artboardBackfill).toBeGreaterThan(modeBranch);
  });

  it("aligns AI edit results to their source without reserving a new grid slot", () => {
    const source = readFileSync(resolve("src/photoshop/imageEditorInsert.ts"), "utf8");
    expect(source).toContain('resolvePlacementMode(app.activeDocument) === "UNSUPPORTED_CANVAS"');
    expect(source).toContain("await alignResultToSource(");
    expect(source).toContain("ready.source.layerId");
    expect(source).toContain("ready.sourceBounds");
    expect(source).not.toContain("planGridSlots");
  });

  it("validates outline placement and moves the Shape above the bound source", () => {
    const panel = readFileSync(resolve("src/app/AiOutlinePanel.tsx"), "utf8");
    const importer = readFileSync(resolve("src/centerline/pathImporter.ts"), "utf8");
    expect(panel).toContain('resolvePlacementMode(app.activeDocument) === "UNSUPPORTED_CANVAS"');
    expect(panel).toContain("pixels.layerId");
    expect(importer).toContain("await alignResultToSource(");
    expect(importer).toContain('{ fit: "preserve", moveAbove: true }');
    expect(panel).not.toContain("planGridSlots");
  });

  it("keeps AI refine source-aligned, grid-contained and out of new-slot planning", () => {
    const source = readFileSync(resolve("src/photoshop/imageRefinerInsert.ts"), "utf8");
    expect(source).toContain('resolvePlacementMode(app.activeDocument) === "UNSUPPORTED_CANVAS"');
    expect(source).toContain('placementMode === "STANDARD_GRID"');
    expect(source).toContain("constrainBoundsToPrimaryGridSlot(source.bounds)");
    expect(source).toContain("targetBounds.bounds");
    expect(source).not.toContain("planGridSlots");
  });
});
