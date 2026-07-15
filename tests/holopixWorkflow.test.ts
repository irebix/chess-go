import { describe, expect, it } from "vitest";
import {
  assertHolopixWorkflow,
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
    expect(workflow["7"]!.inputs.confirm_cost).toBe(false);
  });

  it("uses manual prompt text only when supplied", () => {
    const prepared = prepareHolopixWorkflow(workflow, {
      imageName: "uploaded.png",
      batchSize: 1,
      requestNonce: 456,
      confirmCost: true,
      filenamePrefix: "Holopix/ChessGo/103001",
      promptOverride: "manual prompt"
    });
    expect(prepared.workflow["7"]!.inputs.prompt).toBe("manual prompt");
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
