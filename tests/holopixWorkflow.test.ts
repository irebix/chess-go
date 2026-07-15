import { describe, expect, it } from "vitest";
import {
  assertHolopixWorkflow,
  describeHolopixPromptSource,
  prepareHolopixWorkflow,
  resolveHolopixPromptText,
  splitHolopixBatches,
  type ComfyWorkflow
} from "../src/ai/holopixWorkflow";

const workflow: ComfyWorkflow = {
  "5": { class_type: "HolopixModelStack", inputs: { model_id: 858, strength: 0.6 } },
  "7": {
    class_type: "HolopixGenerate",
    inputs: {
      aspect_ratio: "1:1",
      batch_size: "1",
      request_nonce: 0,
      confirm_cost: false,
      timeout_seconds: 175,
      prompt: "{{name}} game icon, asset {{assetCode}}",
      models: ["5", 0]
    }
  },
  "8": {
    class_type: "ImageScale",
    inputs: { image: ["7", 0], upscale_method: "nearest-exact", width: 768, height: 512, crop: "disabled" }
  },
  "9": { class_type: "SaveImage", inputs: { filename_prefix: "old", images: ["8", 0] } }
};

describe("Holopix workflow adapter", () => {
  it("preserves node parameters while injecting only runtime values", () => {
    const prepared = prepareHolopixWorkflow(workflow, {
      batchSize: 2,
      requestNonce: 123,
      confirmCost: true,
      filenamePrefix: "Holopix/ChessGo/103001",
      itemName: "清洁布",
      assetCode: "103001"
    });
    expect(prepared.workflow["7"]!.inputs).toMatchObject({
      aspect_ratio: "1:1",
      batch_size: "2",
      request_nonce: 123,
      confirm_cost: true,
      timeout_seconds: 175,
      prompt: "清洁布 game icon, asset 103001"
    });
    expect(prepared.workflow["8"]!.inputs).toMatchObject({
      image: ["7", 0],
      width: 1024,
      height: 1024,
      crop: "center"
    });
    expect(prepared.workflow["9"]!.inputs.filename_prefix).toBe("Holopix/ChessGo/103001");
    expect(prepared.workflow["9"]!.inputs.images).toEqual(["8", 0]);
    expect(prepared.promptText).toBe("清洁布 game icon, asset 103001");
    expect(workflow["7"]!.inputs.confirm_cost).toBe(false);
    expect(workflow["8"]!.inputs.width).toBe(768);
  });

  it("reports the exact prompt submitted for the selected item", () => {
    expect(describeHolopixPromptSource(workflow, { itemName: "海绵块", assetCode: "103002" })).toEqual({
      kind: "text",
      label: "HolopixGenerate.prompt · 当前节点",
      detail: "海绵块 game icon, asset 103002"
    });
  });

  it("resolves both supported name placeholders without reading a reference image", () => {
    expect(resolveHolopixPromptText(workflow, { itemName: "喷雾瓶", assetCode: "103004" }))
      .toBe("喷雾瓶 game icon, asset 103004");
  });

  it("splits unsupported three-image requests into valid Holopix batches", () => {
    expect(splitHolopixBatches(1)).toEqual([1]);
    expect(splitHolopixBatches(2)).toEqual([2]);
    expect(splitHolopixBatches(3)).toEqual([2, 1]);
    expect(splitHolopixBatches(4)).toEqual([4]);
  });

  it("rejects workflows with missing required node classes", () => {
    expect(() => assertHolopixWorkflow({})).toThrow(/HolopixGenerate/);
  });

  it("rejects reference-image and prompt-node workflows", () => {
    const withReference = JSON.parse(JSON.stringify(workflow)) as ComfyWorkflow;
    withReference["1"] = { class_type: "LoadImage", inputs: { image: "reference.png" } };
    expect(() => assertHolopixWorkflow(withReference)).toThrow(/提示词-only/);

    const linkedPrompt = JSON.parse(JSON.stringify(workflow)) as ComfyWorkflow;
    linkedPrompt["7"]!.inputs.prompt = ["5", 0];
    expect(() => assertHolopixWorkflow(linkedPrompt)).toThrow(/必须是非空文本/);
  });
});
