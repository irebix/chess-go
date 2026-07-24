import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  imageRefinerOutputGroupName,
  imageRefinerOutputLayerName
} from "../src/imageRefiner/types";

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

  it("creates sibling group or layer results, preserves ordering and supports native PSB smart objects", () => {
    const source = readFileSync(resolve("src/photoshop/imageRefinerInsert.ts"), "utf8");
    const createGroup = source.indexOf("document.createLayerGroup");
    const siblingMove = source.indexOf("outputGroup.move(selectedSource, constants.ElementPlacement.PLACEBEFORE)");
    const singleMove = source.indexOf("placedLayer.move(selectedSource, constants.ElementPlacement.PLACEBEFORE)");
    const firstInside = source.indexOf("placedLayer.move(outputGroup as LayerLike, constants.ElementPlacement.PLACEINSIDE)");
    const nextAfter = source.indexOf("placedLayer.move(previousLayer, constants.ElementPlacement.PLACEAFTER)");
    const place = source.indexOf("placeEmbeddedDescriptor(temporaryResults[index]!.token)");
    const psbWrap = source.indexOf(
      "convertSelectedLayerToEmbeddedSmartObjectDescriptor()",
      place
    );
    const placedLayer = source.indexOf(
      "const placedLayer = document.activeLayers?.[0]",
      psbWrap
    );
    const gridConstraint = source.indexOf('placementMode === "STANDARD_GRID"');
    const target = source.indexOf("constrainBoundsToPrimaryGridSlot(source.bounds)", gridConstraint);
    const fit = source.indexOf("await fitLayerInsideBounds(", target);
    const fitTarget = source.indexOf("targetBounds.bounds", fit);
    const optionalRasterize = source.indexOf("if (!options.keepSmartObject)", fit);
    const rasterize = source.indexOf('_obj: "rasterizeLayer"', fit);
    expect(createGroup).toBeGreaterThan(-1);
    expect(siblingMove).toBeGreaterThan(createGroup);
    expect(place).toBeGreaterThan(siblingMove);
    expect(psbWrap).toBeGreaterThan(place);
    expect(placedLayer).toBeGreaterThan(psbWrap);
    expect(singleMove).toBeGreaterThan(siblingMove);
    expect(firstInside).toBeGreaterThan(siblingMove);
    expect(nextAfter).toBeGreaterThan(firstInside);
    expect(gridConstraint).toBeGreaterThan(nextAfter);
    expect(target).toBeGreaterThan(gridConstraint);
    expect(fit).toBeGreaterThan(nextAfter);
    expect(fitTarget).toBeGreaterThan(fit);
    expect(optionalRasterize).toBeGreaterThan(fit);
    expect(rasterize).toBeGreaterThan(optionalRasterize);
    expect(imageRefinerOutputGroupName("角色")).toBe("角色 细化");
    expect(imageRefinerOutputLayerName("钥匙")).toBe("钥匙 细化");
  });

  it("accepts either one active image layer or a recursively collected group", () => {
    const source = readFileSync(resolve("src/photoshop/imageRefinerSource.ts"), "utf8");
    expect(source).toContain("export function inspectActiveImageRefinerSource");
    expect(source).toContain('selectionKind: "layer"');
    expect(source).toContain("layers: [layer]");
    expect(source).toContain('selectionKind: "group"');
    expect(source).toContain("collectEligibleLayers(");
  });

  it("ships the refiner workflow and fixed style reference through every runtime path", () => {
    const webpackSource = readFileSync(resolve("webpack.config.js"), "utf8");
    expect(webpackSource).toContain("ImageRefiner.json");
    expect(webpackSource).toContain("ImageRefinerStyle.png");
    const publisher = readFileSync(resolve("scripts/publish-release.ps1"), "utf8");
    const installer = readFileSync(resolve("installer/install.cmd"), "utf8");
    expect(publisher).toContain("Get-ChildItem -LiteralPath $distFolder -File -Recurse");
    expect(publisher).toContain('releaseManifestName = "release-manifest.json"');
    expect(installer).toContain("function Get-ChessGoReleasePayload");
    expect(installer).toContain('releaseManifestName = "release-manifest.json"');
    const styleReference = readFileSync(resolve("ImageRefinerStyle.png"));
    expect(Array.from(styleReference.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(styleReference.readUInt32BE(16)).toBe(880);
    expect(styleReference.readUInt32BE(20)).toBe(1184);
    expect(createHash("sha256").update(styleReference).digest("hex"))
      .toBe("845cfb2161fddbd04501d99519eb8e5668bff8321f2f94ba5a052b1eb2d0ea6d");
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

  it("waits up to 600 seconds for slow V3 refinement jobs", () => {
    const client = readFileSync(resolve("src/imageRefiner/client.ts"), "utf8");
    expect(client).toContain("const IMAGE_REFINER_RESULT_TIMEOUT_SECONDS = 600;");
    expect(client).toContain(
      "Math.max(IMAGE_REFINER_RESULT_TIMEOUT_SECONDS, prepared.timeoutSeconds + 90)"
    );
  });

  it("keeps the UXP prompt editor empty and treats it as an optional suffix", () => {
    const panel = readFileSync(resolve("src/app/AiRefinePanel.tsx"), "utf8");
    expect(panel).toContain('const [promptText, setPromptText] = useState("")');
    expect(panel).toContain("const [keepSmartObject, setKeepSmartObject] = useState(true)");
    expect(panel).toContain("补充要求（可选）");
    expect(panel).toContain("填写内容会追加到 ComfyUI 主提示词末尾");
    expect(panel).toContain("插入为 PSB 智能对象");
    expect(panel).not.toContain("IMAGE_REFINER_DEFAULT_PROMPT");
  });
});
