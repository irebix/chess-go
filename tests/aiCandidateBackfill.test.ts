import { describe, expect, it } from "vitest";
import {
  findEditableCanvasLayer,
  findEditableCanvasTarget,
  isEditableCanvasLayerName
} from "../src/photoshop/aiCandidateTarget";

describe("AI candidate PSD target lookup", () => {
  it("recognizes only generated blank smart-object layer names", () => {
    expect(isEditableCanvasLayerName("148x148_空白智能对象")).toBe(true);
    expect(isEditableCanvasLayerName("参考图")).toBe(false);
  });

  it("finds the nested editable canvas in the matching asset artboard", () => {
    const target = { id: 8, name: "148x148_空白智能对象" };
    const document = {
      layers: {
        0: { id: 1, name: "103001", layers: { 0: target, length: 1 } },
        1: { id: 2, name: "103002", layers: { 0: { id: 9, name: "参考图" }, length: 1 } },
        length: 2
      }
    };
    expect(findEditableCanvasLayer(document, "103001")).toBe(target);
    expect(findEditableCanvasTarget(document, "103001")).toEqual({
      artboard: document.layers[0],
      layer: target
    });
    expect(findEditableCanvasLayer(document, "103002")).toBeUndefined();
  });
});
