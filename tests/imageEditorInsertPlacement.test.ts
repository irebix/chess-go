import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("AI image editor nested layer placement", () => {
  it("explicitly moves a generated layer above its exact source before fitting bounds", () => {
    const source = readFileSync(resolve("src/photoshop/imageEditorInsert.ts"), "utf8");
    const moveAbove = source.indexOf(
      "placedLayer.move(sourceLayer as never, constants.ElementPlacement.PLACEBEFORE)"
    );
    const reacquire = source.indexOf("const positionedLayer = findLayerById", moveAbove);
    const fit = source.indexOf("await fitLayerInsideBounds(positionedLayer", reacquire);

    expect(moveAbove).toBeGreaterThan(-1);
    expect(reacquire).toBeGreaterThan(moveAbove);
    expect(fit).toBeGreaterThan(reacquire);
  });
});
