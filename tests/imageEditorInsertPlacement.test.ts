import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("AI image editor nested layer placement", () => {
  it("routes source placement through the shared aligner after mode and source validation", () => {
    const insertSource = readFileSync(resolve("src/photoshop/imageEditorInsert.ts"), "utf8");
    const geometrySource = readFileSync(resolve("src/photoshop/layerPlacementGeometry.ts"), "utf8");
    const modeCheck = insertSource.indexOf('resolvePlacementMode(app.activeDocument) === "UNSUPPORTED_CANVAS"');
    const sourceCheck = insertSource.indexOf("const sourceLayer = findLayerById(", modeCheck);
    const place = insertSource.indexOf("placeEmbeddedDescriptor(token)", sourceCheck);
    const psbWrap = insertSource.indexOf(
      "convertSelectedLayerToEmbeddedSmartObjectDescriptor()",
      place
    );
    const placedLayer = insertSource.indexOf("const placedLayer = document.activeLayers?.[0]", psbWrap);
    const align = insertSource.indexOf("await alignResultToSource(", sourceCheck);

    expect(modeCheck).toBeGreaterThan(-1);
    expect(sourceCheck).toBeGreaterThan(-1);
    expect(place).toBeGreaterThan(sourceCheck);
    expect(psbWrap).toBeGreaterThan(place);
    expect(placedLayer).toBeGreaterThan(psbWrap);
    expect(align).toBeGreaterThan(sourceCheck);
    expect(insertSource).toContain("ready.source.layerId");
    expect(insertSource).toContain("ready.sourceBounds");
    expect(insertSource).toContain('moveAbove: options.insertPosition === "above"');
    expect(geometrySource.indexOf("await resultLayer.move(sourceLayer", geometrySource.indexOf("alignResultToSource")))
      .toBeGreaterThan(-1);
    expect(geometrySource).toContain("return fitLayerInsideBounds(");
  });
});
