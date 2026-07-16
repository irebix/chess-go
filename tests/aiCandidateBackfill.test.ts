import { describe, expect, it } from "vitest";
import {
  findEditableCanvasLayer,
  findEditableCanvasTarget,
  findEditableCanvasTargetByIds,
  findEditableCanvasTargets,
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
      layer: target,
      path: [target]
    });
    expect(findEditableCanvasLayer(document, "103002")).toBeUndefined();
  });

  it("reports every matching target instead of silently choosing a duplicate", () => {
    const document = {
      layers: {
        0: { id: 1, name: "103001", layers: { 0: { id: 8, name: "148x148_空白智能对象" }, length: 1 } },
        1: { id: 2, name: "103001", layers: { 0: { id: 9, name: "1024x1024_空白智能对象" }, length: 1 } },
        length: 2
      }
    };

    expect(findEditableCanvasTargets(document, "103001").map((target) => target.layer.id)).toEqual([8, 9]);
  });

  it("reacquires the same layer by stable IDs even when it is temporarily outside the artboard collection", () => {
    const target = { id: 8, name: "148x148_空白智能对象" };
    const artboard = { id: 1, name: "103001", layers: { length: 0 } };
    const document = {
      artboards: { 0: artboard, length: 1 },
      layers: {
        0: artboard,
        1: { id: 7, name: "临时容器", layers: { 0: target, length: 1 } },
        length: 2
      }
    };

    expect(findEditableCanvasTargetByIds(document, 1, 8)).toEqual({
      artboard,
      layer: target,
      path: [document.layers[1], target]
    });
  });
});
