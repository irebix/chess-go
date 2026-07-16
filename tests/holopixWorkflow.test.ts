import { describe, expect, it } from "vitest";
import {
  assertHolopixWorkflow,
  describeHolopixPromptSource,
  prepareHolopixWorkflow,
  splitHolopixBatches,
  type ComfyWorkflow
} from "../src/ai/holopixWorkflow";

const workflow: ComfyWorkflow = {
  "1": { class_type: "LoadImage", inputs: { image: "reference.png" } },
  "2": { class_type: "HolopixUploadReference", inputs: { image: ["1", 0] } },
  "5": { class_type: "HolopixModelStack", inputs: { model_id: 858, strength: 0.6 } },
  "6": {
    class_type: "HolopixImageToPrompt",
    inputs: { reference: ["2", 0], models: ["5", 0] },
    _meta: { title: "Holopix 图片转提示词" }
  },
  "7": {
    class_type: "HolopixGenerate",
    inputs: {
      aspect_ratio: "4:3",
      batch_size: "1",
      request_nonce: 0,
      confirm_cost: false,
      timeout_seconds: 175,
      prompt: ["6", 0],
      models: ["5", 0]
    }
  },
  "8": {
    class_type: "ImageScale",
    inputs: { image: ["7", 0], upscale_method: "nearest-exact", width: 768, height: 512, crop: "disabled" }
  },
  "9": { class_type: "SaveImage", inputs: { filename_prefix: "old", images: ["8", 0] } },
  "10": {
    class_type: "easy showAnything",
    inputs: { anything: ["6", 0] },
    _meta: { title: "记录 Holopix 实际提示词" }
  }
};

describe("Holopix workflow adapter", () => {
  it("uses the reference only for image-to-prompt and keeps generation prompt-only", () => {
    const prepared = prepareHolopixWorkflow(workflow, {
      imageName: "uploaded/reference.png",
      batchSize: 2,
      requestNonce: 123,
      confirmCost: true,
      filenamePrefix: "Holopix/ChessGo/103001"
    });
    expect(prepared.workflow["1"]!.inputs.image).toBe("uploaded/reference.png");
    expect(prepared.workflow["2"]!.inputs.image).toEqual(["1", 0]);
    expect(prepared.workflow["6"]!.inputs.reference).toEqual(["2", 0]);
    expect(prepared.workflow["7"]!.inputs).toMatchObject({
      aspect_ratio: "1:1",
      batch_size: "2",
      request_nonce: 123,
      confirm_cost: true,
      timeout_seconds: 175,
      prompt: ["6", 0]
    });
    expect(prepared.workflow["7"]!.inputs).not.toHaveProperty("reference");
    expect(prepared.workflow["8"]!.inputs).toMatchObject({
      image: ["7", 0],
      width: 1024,
      height: 1024,
      crop: "center"
    });
    expect(prepared.workflow["9"]!.inputs.filename_prefix).toBe("Holopix/ChessGo/103001");
    expect(prepared.workflow["9"]!.inputs.images).toEqual(["8", 0]);
    expect(prepared.workflow["10"]!.inputs.anything).toEqual(["6", 0]);
    expect(prepared.promptCaptureNodeId).toBe("10");
    expect(workflow["7"]!.inputs.confirm_cost).toBe(false);
    expect(workflow["8"]!.inputs.width).toBe(768);
  });

  it("reports the image-to-prompt node as the live prompt source", () => {
    expect(describeHolopixPromptSource(workflow)).toEqual({
      kind: "node",
      label: "Holopix 图片转提示词",
      detail: "等待生成或恢复后显示该节点返回的实际提示词（节点 6）。"
    });
  });

  it("reuses an already captured prompt for a later split batch", () => {
    const prepared = prepareHolopixWorkflow(workflow, {
      imageName: "uploaded/reference.png",
      batchSize: 1,
      requestNonce: 124,
      confirmCost: true,
      filenamePrefix: "Holopix/ChessGo/103001",
      promptText: "same captured cleaning cloth prompt"
    });

    expect(prepared.workflow["7"]!.inputs.prompt).toBe("same captured cleaning cloth prompt");
    expect(prepared.workflow["10"]!.inputs.anything).toBe("same captured cleaning cloth prompt");
    expect(prepared.workflow["7"]!.inputs).not.toHaveProperty("reference");
  });

  it("splits unsupported three-image requests into valid Holopix batches", () => {
    expect(splitHolopixBatches(1)).toEqual([1]);
    expect(splitHolopixBatches(2)).toEqual([2]);
    expect(splitHolopixBatches(3)).toEqual([2, 1]);
    expect(splitHolopixBatches(4)).toEqual([4]);
  });

  it("rejects workflows with missing required node classes", () => {
    expect(() => assertHolopixWorkflow({})).toThrow(/LoadImage/);
  });

  it("rejects connecting the reference directly to HolopixGenerate", () => {
    const withImg2Img = JSON.parse(JSON.stringify(workflow)) as ComfyWorkflow;
    withImg2Img["7"]!.inputs.reference = ["2", 0];
    expect(() => assertHolopixWorkflow(withImg2Img)).toThrow(/不能连接 reference/);
  });

  it("rejects a prompt that bypasses HolopixImageToPrompt", () => {
    const literalPrompt = JSON.parse(JSON.stringify(workflow)) as ComfyWorkflow;
    literalPrompt["7"]!.inputs.prompt = "literal prompt";
    expect(() => assertHolopixWorkflow(literalPrompt)).toThrow(/必须连接 HolopixImageToPrompt/);
  });
});
