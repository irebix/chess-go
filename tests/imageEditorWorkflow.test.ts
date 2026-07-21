import { describe, expect, it } from "vitest";
import bundledWorkflow from "../ImageEditor.json";
import type { ComfyWorkflow } from "../src/ai/holopixWorkflow";
import {
  assertImageEditorWorkflow,
  prepareImageEditorWorkflow
} from "../src/imageEditor/workflow";

describe("AI image editor workflow", () => {
  it("keeps independent V2/V3 branches behind white 512 px square padding", () => {
    expect(() => assertImageEditorWorkflow(bundledWorkflow)).not.toThrow();
    const paddingNodes = Object.values(bundledWorkflow).filter((node) => node.class_type === "ResizeAndPadImage");
    expect(paddingNodes).toHaveLength(2);
    for (const node of paddingNodes) {
      expect(node.inputs).toMatchObject({
        target_width: 512,
        target_height: 512,
        padding_color: "white",
        interpolation: "lanczos"
      });
    }
  });

  it("prunes V3 when preparing V2 so only one paid output node executes", () => {
    const prepared = prepareImageEditorWorkflow(bundledWorkflow, {
      workflowVersion: "v2",
      imageName: "chessgo_image_editor/run-1/selected.ppm",
      promptText: "改成蓝色陶瓷材质",
      batchSize: 2,
      requestNonce: 101,
      filenamePrefix: "Holopix/ChessGo/ImageEditor/V2/101"
    });
    expect(Object.values(prepared.workflow).map((node) => node.class_type)).toEqual([
      "HolopixGenerateV2",
      "LoadImage",
      "PrimitiveStringMultiline",
      "SaveImage",
      "ResizeAndPadImage",
      "BiRefNetRMBG"
    ]);
    expect(prepared.workflow["1"]?.inputs).toMatchObject({
      aspect_ratio: "1:1",
      batch_size: "2",
      request_nonce: 101,
      confirm_cost: true,
      images: ["5", 0]
    });
    expect(prepared.workflow["2"]?.inputs.image).toBe("chessgo_image_editor/run-1/selected.ppm");
    expect(prepared.workflow["3"]?.inputs.value).toBe("改成蓝色陶瓷材质");
  });

  it("prepares V3 without retaining the V2 output node", () => {
    const prepared = prepareImageEditorWorkflow(bundledWorkflow, {
      workflowVersion: "v3",
      imageName: "selected.ppm",
      promptText: "增加金属高光",
      batchSize: 4,
      requestNonce: 202,
      filenamePrefix: "Holopix/ChessGo/ImageEditor/V3/202"
    });
    expect(prepared.generateNodeId).toBe("10");
    expect(prepared.saveNodeId).toBe("13");
    expect(Object.values(prepared.workflow).some((node) => node.class_type === "HolopixGenerateV2")).toBe(false);
    expect(prepared.workflow["10"]?.inputs).toMatchObject({
      batch_size: "4",
      request_nonce: 202,
      images: ["11", 0]
    });
  });

  it("rejects a square preprocessing edge that is not greater than 300 px", () => {
    const invalid = JSON.parse(JSON.stringify(bundledWorkflow)) as ComfyWorkflow;
    invalid["5"]!.inputs.target_width = 300;
    invalid["5"]!.inputs.target_height = 300;
    expect(() => assertImageEditorWorkflow(invalid)).toThrow(/大于 300 px/);
  });
});
