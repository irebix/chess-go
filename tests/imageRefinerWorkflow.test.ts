import { describe, expect, it } from "vitest";
import bundledWorkflow from "../ImageRefiner.json";
import type { ComfyWorkflow } from "../src/ai/holopixWorkflow";
import { IMAGE_REFINER_BASE_PROMPT } from "../src/imageRefiner/types";
import {
  assertImageRefinerWorkflow,
  prepareImageRefinerWorkflow
} from "../src/imageRefiner/workflow";

describe("AI image refiner workflow", () => {
  it("keeps the V3 pack/unpack graph, current VIP interface and GPT-style matting tail", () => {
    expect(() => assertImageRefinerWorkflow(bundledWorkflow)).not.toThrow();
    expect(bundledWorkflow["5"]?.inputs).toMatchObject({
      batch_size: "1",
      vip_channel: true,
      images: ["15", 0],
      prompt: ["4", 0]
    });
    expect(bundledWorkflow["5"]?.inputs).not.toHaveProperty("confirm_cost");
    expect(bundledWorkflow["6"]?.inputs).toMatchObject({
      output_size: 512,
      returned_sheet: ["5", 0],
      layout: ["2", 1]
    });
    expect(bundledWorkflow["11"]?.inputs).toMatchObject({
      model: "BiRefNet_toonout",
      image: ["6", 0],
      background: "Alpha"
    });
    expect(bundledWorkflow["12"]?.inputs.mask).toEqual(["11", 1]);
    expect(bundledWorkflow["13"]?.inputs).toMatchObject({
      image: ["11", 0],
      alpha: ["12", 0]
    });
    expect(bundledWorkflow["14"]?.inputs.image).toBe("chessgo_image_refiner/style/blob");
    expect(bundledWorkflow["15"]?.inputs).toMatchObject({
      image1: ["2", 0],
      image2: ["14", 0]
    });
  });

  it("injects an ordered upload batch, prompt, nonce and isolated output folder", () => {
    const prepared = prepareImageRefinerWorkflow(bundledWorkflow, {
      inputSubfolder: "chessgo_image_refiner/run-101",
      fileNames: ["001/blob", "002/blob"],
      styleImagePath: "chessgo_image_refiner/run-101/style/blob",
      promptSupplement: "保持构图并细化材质",
      requestNonce: 101,
      outputSubfolder: "Holopix/ChessGo/ImageRefiner/101"
    });
    expect(prepared.generateNodeId).toBe("5");
    expect(prepared.saveNodeId).toBe("8");
    expect(prepared.workflow["1"]?.inputs).toMatchObject({
      input_subfolder: "chessgo_image_refiner/run-101",
      file_names: '["001/blob","002/blob"]',
      recursive: false,
      max_images: 2
    });
    expect(prepared.workflow["2"]?.inputs.max_images).toBe(2);
    expect(prepared.workflow["4"]?.inputs.value).toBe(
      `${IMAGE_REFINER_BASE_PROMPT}\n保持构图并细化材质`
    );
    expect(prepared.workflow["14"]?.inputs.image).toBe("chessgo_image_refiner/run-101/style/blob");
    expect(prepared.workflow["15"]?.inputs).toMatchObject({
      image1: ["2", 0],
      image2: ["14", 0]
    });
    expect(prepared.workflow["5"]?.inputs).toMatchObject({
      batch_size: "1",
      request_nonce: 101,
      vip_channel: true,
      aspect_ratio: ["2", 2]
    });
    expect(prepared.workflow["5"]?.inputs).not.toHaveProperty("confirm_cost");
    expect(prepared.workflow["8"]?.inputs).toMatchObject({
      subfolder: "Holopix/ChessGo/ImageRefiner/101",
      collision_policy: "overwrite",
      images: ["13", 0],
      names: ["6", 1]
    });
    expect(prepared.workflow["11"]?.inputs.image).toEqual(["6", 0]);
    expect(prepared.workflow["12"]?.inputs.mask).toEqual(["11", 1]);
    expect(prepared.workflow["13"]?.inputs).toMatchObject({
      image: ["11", 0],
      alpha: ["12", 0]
    });
  });

  it("uses only the hidden base prompt when the optional UXP supplement is empty", () => {
    const prepared = prepareImageRefinerWorkflow(bundledWorkflow, {
      inputSubfolder: "chessgo_image_refiner/run-102",
      fileNames: ["001/blob"],
      styleImagePath: "chessgo_image_refiner/run-102/style/blob",
      promptSupplement: "   ",
      requestNonce: 102,
      outputSubfolder: "Holopix/ChessGo/ImageRefiner/102"
    });
    expect(prepared.workflow["4"]?.inputs.value).toBe(IMAGE_REFINER_BASE_PROMPT);
  });

  it("rejects unsafe upload names and broken pack links", () => {
    expect(() => prepareImageRefinerWorkflow(bundledWorkflow, {
      inputSubfolder: "chessgo_image_refiner/run-1",
      fileNames: ["../bad.png"],
      styleImagePath: "chessgo_image_refiner/run-1/style/blob",
      promptSupplement: "细化",
      requestNonce: 1,
      outputSubfolder: "Holopix/ChessGo/ImageRefiner/1"
    })).toThrow(/文件名无效/);

    const invalid = JSON.parse(JSON.stringify(bundledWorkflow)) as ComfyWorkflow;
    invalid["2"]!.inputs.images = ["5", 0];
    expect(() => assertImageRefinerWorkflow(invalid)).toThrow(/连线无效/);

    const invalidReferenceBatch = JSON.parse(JSON.stringify(bundledWorkflow)) as ComfyWorkflow;
    invalidReferenceBatch["15"]!.inputs.image1 = ["14", 0];
    expect(() => assertImageRefinerWorkflow(invalidReferenceBatch)).toThrow(/ImageBatch\.image1/);

    const invalidMatting = JSON.parse(JSON.stringify(bundledWorkflow)) as ComfyWorkflow;
    invalidMatting["13"]!.inputs.alpha = ["11", 1];
    expect(() => assertImageRefinerWorkflow(invalidMatting)).toThrow(/JoinImageWithAlpha\.alpha/);
  });
});
