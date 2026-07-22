import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { imageRefinerOutputGroupName } from "../src/imageRefiner/types";

describe("AI image refiner integration", () => {
  it("renders AI refinement directly below AI outline", () => {
    const appSource = readFileSync(resolve("src/app/App.tsx"), "utf8");
    const edit = appSource.indexOf("<AiEditPanel");
    const outline = appSource.indexOf("<AiOutlinePanel", edit);
    const refine = appSource.indexOf("<AiRefinePanel", outline);
    const generator = appSource.indexOf("generator-panel", refine);
    expect(edit).toBeGreaterThan(-1);
    expect(outline).toBeGreaterThan(edit);
    expect(refine).toBeGreaterThan(outline);
    expect(generator).toBeGreaterThan(refine);
  });

  it("creates a sibling result group, preserves output ordering and fits after hierarchy moves", () => {
    const source = readFileSync(resolve("src/photoshop/imageRefinerInsert.ts"), "utf8");
    const createGroup = source.indexOf("document.createLayerGroup");
    const siblingMove = source.indexOf("outputGroup.move(sourceGroup, constants.ElementPlacement.PLACEBEFORE)");
    const firstInside = source.indexOf("placedLayer.move(outputGroup, constants.ElementPlacement.PLACEINSIDE)");
    const nextAfter = source.indexOf("placedLayer.move(previousLayer, constants.ElementPlacement.PLACEAFTER)");
    const fit = source.indexOf("await fitLayerInsideBounds(positionedLayer, source.bounds)");
    const rasterize = source.indexOf('_obj: "rasterizeLayer"', fit);
    expect(createGroup).toBeGreaterThan(-1);
    expect(siblingMove).toBeGreaterThan(createGroup);
    expect(firstInside).toBeGreaterThan(siblingMove);
    expect(nextAfter).toBeGreaterThan(firstInside);
    expect(fit).toBeGreaterThan(nextAfter);
    expect(rasterize).toBeGreaterThan(fit);
    expect(imageRefinerOutputGroupName("角色")).toBe("角色 细化");
  });

  it("ships the refiner workflow and fixed style reference through every runtime path", () => {
    for (const path of ["webpack.config.js", "scripts/publish-release.ps1", "installer/install.cmd"]) {
      const source = readFileSync(resolve(path), "utf8");
      expect(source).toContain("ImageRefiner.json");
      expect(source).toContain("ImageRefinerStyle.png");
    }
    expect(Array.from(readFileSync(resolve("ImageRefinerStyle.png")).subarray(0, 8)))
      .toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  });

  it("requests alpha pixels before encoding each selected group layer as PNG", () => {
    const client = readFileSync(resolve("src/imageRefiner/client.ts"), "utf8");
    expect(client).toContain("includeAlpha: true");
    expect(client).toContain("pixelsToPng(pixels)");
    expect(client).toContain('folder.getEntry(IMAGE_REFINER_STYLE_ASSET)');
    expect(client).toContain("storage.formats.binary");
    expect(client).toContain('options.onStage?.("正在上传固定风格参考图 · 图2")');
    expect(client).toContain("const form = new FormData()");
    expect(client).toContain('form.append("subfolder", itemSubfolder)');
    expect(client).not.toContain('headers: { "Content-Type": multipart.contentType }');
  });

  it("keeps the UXP prompt editor empty and treats it as an optional suffix", () => {
    const panel = readFileSync(resolve("src/app/AiRefinePanel.tsx"), "utf8");
    expect(panel).toContain('const [promptText, setPromptText] = useState("")');
    expect(panel).toContain("补充要求（可选）");
    expect(panel).toContain("填写内容会追加到 ComfyUI 主提示词末尾");
    expect(panel).not.toContain("IMAGE_REFINER_DEFAULT_PROMPT");
  });
});
