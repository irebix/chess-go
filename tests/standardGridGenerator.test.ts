import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("standard grid PSD generator", () => {
  it("ships the exact 1780 by 1188 background selected for the standard template", () => {
    const background = readFileSync(resolve("StandardGridBackground.png"));
    expect(Array.from(background.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(background.readUInt32BE(16)).toBe(1780);
    expect(background.readUInt32BE(20)).toBe(1188);
    expect(createHash("sha256").update(background).digest("hex"))
      .toBe("80f9811e7f3fcaadcb3427def263c249bc8fbe81d2fe0eac4b3d885617266698");
  });

  it("creates, backgrounds, initializes, verifies and saves one non-artboard PSD", () => {
    const source = readFileSync(resolve("src/photoshop/StandardGridDocumentGenerator.ts"), "utf8");
    const createDocument = source.indexOf("await app.createDocument({");
    const placeBackground = source.indexOf("placeEmbeddedDescriptor(backgroundToken)", createDocument);
    const initializeMetadata = source.indexOf("await initializeGridMetadataStore(", placeBackground);
    const verifyMode = source.indexOf('mode !== "STANDARD_GRID"', initializeMetadata);
    const savePsd = source.indexOf("await document.saveAs.psd(", verifyMode);
    expect(source).toContain("width: STANDARD_GRID_TEMPLATE.canvas.width");
    expect(source).toContain("height: STANDARD_GRID_TEMPLATE.canvas.height");
    expect(source).toContain("fill: constants.DocumentFill.TRANSPARENT");
    expect(source).toContain("backgroundLayer.name = GRID_BACKGROUND_LAYER_NAME");
    expect(source).toContain("{ allowUpscale: true, tolerance: 1 }");
    expect(createDocument).toBeGreaterThan(-1);
    expect(placeBackground).toBeGreaterThan(createDocument);
    expect(initializeMetadata).toBeGreaterThan(placeBackground);
    expect(verifyMode).toBeGreaterThan(initializeMetadata);
    expect(savePsd).toBeGreaterThan(verifyMode);
  });

  it("uses the shared primary button inside Generate PSD instead of a standalone panel", () => {
    const app = readFileSync(resolve("src/app/App.tsx"), "utf8");
    const generatePsd = app.indexOf("<span>生成 PSD</span>");
    const generatorContent = app.indexOf('className="panel-section-content generator-content"', generatePsd);
    const generateGrid = app.indexOf("onClick={() => void handleGenerateStandardGrid()}", generatorContent);
    const sharedPrimary = app.lastIndexOf('className="primary"', generateGrid);
    const diagnostics = app.indexOf("<span>运行与诊断</span>");
    expect(generatePsd).toBeGreaterThan(-1);
    expect(generatorContent).toBeGreaterThan(generatePsd);
    expect(generateGrid).toBeGreaterThan(generatorContent);
    expect(sharedPrimary).toBeGreaterThan(generatorContent);
    expect(generateGrid - sharedPrimary).toBeLessThan(160);
    expect(diagnostics).toBeGreaterThan(generateGrid);
    expect(app).not.toContain("grid-canvas-generator-panel");
    expect(app).not.toContain("grid-canvas-generator-action");

    const webpack = readFileSync(resolve("webpack.config.js"), "utf8");
    expect(webpack).toContain('{ from: "StandardGridBackground.png", to: "StandardGridBackground.png" }');
  });
});
