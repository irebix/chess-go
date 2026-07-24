import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("AI draft refinement compatibility", () => {
  it("keeps refined children outside the draft namespace and ignores legacy result groups", () => {
    const insert = readFileSync(resolve("src/photoshop/imageRefinerInsert.ts"), "utf8");
    const grid = readFileSync(resolve("src/photoshop/StandardGridCanvasService.ts"), "utf8");

    expect(insert).toContain("placedLayer.name = imageRefinerOutputLayerName(source.layerName)");
    expect(insert).not.toContain('? source.layerName\n            : imageRefinerOutputLayerName(source.layerName)');
    expect(grid).toContain("isGridDraftRefinementGroupName(name, chainId)");
    expect(grid).toContain("record.ancestorGroupNames.some(");
  });
});
