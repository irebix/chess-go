import { describe, expect, it } from "vitest";
import {
  assertHolopixWorkflow,
  describeHolopixPromptSource,
  prepareHolopixWorkflow,
  splitHolopixBatches,
  type ComfyWorkflow
} from "../src/ai/holopixWorkflow";

const workflow: ComfyWorkflow = {
  "1": { class_type: "LoadImage", inputs: { image: "old.png" } },
  "2": { class_type: "HolopixUploadReference", inputs: { image: ["1", 0] } },
  "5": { class_type: "HolopixModelStack", inputs: { model_id: 858, strength: 0.6 } },
  "6": { class_type: "HolopixImageToPrompt", inputs: { reference: ["2", 0], models: ["5", 0] } },
  "7": {
    class_type: "HolopixGenerate",
    inputs: {
      aspect_ratio: "1:1",
      batch_size: "1",
      request_nonce: 0,
      confirm_cost: false,
      timeout_seconds: 175,
      prompt: ["6", 0],
      models: ["5", 0]
    }
  },
  "9": { class_type: "SaveImage", inputs: { filename_prefix: "old", images: ["7", 0] } }
};

describe("Holopix workflow adapter", () => {
  it("preserves node parameters while injecting only runtime values", () => {
    const prepared = prepareHolopixWorkflow(workflow, {
      imageName: "uploaded.png",
      batchSize: 2,
      requestNonce: 123,
      confirmCost: true,
      filenamePrefix: "Holopix/ChessGo/103001"
    });
    expect(prepared.workflow["7"]!.inputs).toMatchObject({
      aspect_ratio: "1:1",
      batch_size: "2",
      request_nonce: 123,
      confirm_cost: true,
      timeout_seconds: 175,
      prompt: ["6", 0],
      reference: ["2", 0]
    });
    expect(prepared.workflow["1"]!.inputs.image).toBe("uploaded.png");
    expect(prepared.workflow["9"]!.inputs.filename_prefix).toBe("Holopix/ChessGo/103001");
    const preview = prepared.workflow[prepared.previewNodeId]!;
    const scaleNodeId = (preview.inputs.images as [string, number])[0];
    expect(preview).toMatchObject({
      class_type: "PreviewImage",
      inputs: { images: [scaleNodeId, 0] }
    });
    expect(prepared.workflow[scaleNodeId]).toMatchObject({
      class_type: "ImageScale",
      inputs: {
        image: ["7", 0],
        upscale_method: "lanczos",
        width: 96,
        height: 96,
        crop: "center"
      }
    });
    expect(workflow["7"]!.inputs.confirm_cost).toBe(false);
    expect(Object.keys(workflow)).toHaveLength(6);
  });

  it("reports the workflow node that supplies the prompt", () => {
    expect(describeHolopixPromptSource(workflow)).toEqual({
      kind: "node",
      label: "HolopixImageToPrompt",
      detail: "HolopixImageToPrompt · 节点 6"
    });
  });

  it("reports literal prompt text directly from the workflow", () => {
    const literalWorkflow = JSON.parse(JSON.stringify(workflow)) as ComfyWorkflow;
    literalWorkflow["7"]!.inputs.prompt = "prompt stored in workflow";
    expect(describeHolopixPromptSource(literalWorkflow)).toEqual({
      kind: "text",
      label: "HolopixGenerate.prompt",
      detail: "prompt stored in workflow"
    });
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
});
