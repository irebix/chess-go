import { describe, expect, it, vi } from "vitest";
import bundledWorkflow from "../GPlusF.json";
import type { ComfyWorkflow } from "../src/ai/holopixWorkflow";

vi.mock("uxp", () => ({
  storage: {
    formats: { binary: "binary", utf8: "utf8" },
    localFileSystem: {}
  }
}));

import {
  bindGPlusFStyleReference,
  G_PLUS_F_REFERENCE_UPLOAD_TIMEOUT_RESERVE_SECONDS,
  G_PLUS_F_STYLE_ASSET,
  gPlusFEstimatedCostPoints,
  gPlusFRequestNonces,
  gPlusFResultTimeoutSeconds,
  gPlusFStyleUploadSubfolder
} from "../src/ai/gPlusFClient";
import { G_PLUS_F_NODE_TITLES } from "../src/ai/gPlusFWorkflow";

describe("G+F runtime client", () => {
  it("uses two distinct request nonces, including at the modulo boundary", () => {
    expect(gPlusFRequestNonces(123)).toEqual({
      gptRequestNonce: 123,
      holopixRequestNonce: 124
    });
    expect(gPlusFRequestNonces(1_999_999_999)).toEqual({
      gptRequestNonce: 1_999_999_999,
      holopixRequestNonce: 0
    });
  });

  it("estimates one GPT sheet plus one Holopix refinement per cropped item", () => {
    expect(gPlusFEstimatedCostPoints(1)).toBe(38);
    expect(gPlusFEstimatedCostPoints(2)).toBe(41);
    expect(gPlusFEstimatedCostPoints(12)).toBe(71);
    expect(() => gPlusFEstimatedCostPoints(0)).toThrow("正安全整数");
    expect(() => gPlusFEstimatedCostPoints(1.5)).toThrow("正安全整数");
  });

  it("reserves a separate upload timeout for every serial refinement", () => {
    expect(G_PLUS_F_REFERENCE_UPLOAD_TIMEOUT_RESERVE_SECONDS).toBe(90);
    expect(gPlusFResultTimeoutSeconds(450, 3)).toBe(720);
    expect(gPlusFResultTimeoutSeconds(450.2, 2)).toBe(631);
    expect(() => gPlusFResultTimeoutSeconds(0, 1)).toThrow("正有限数字");
    expect(() => gPlusFResultTimeoutSeconds(150, 0)).toThrow("正安全整数");
  });

  it("binds the uploaded built-in style image to the unique LoadImage node", () => {
    const workflow = JSON.parse(JSON.stringify(bundledWorkflow)) as ComfyWorkflow;
    bindGPlusFStyleReference(workflow, `input\\${G_PLUS_F_STYLE_ASSET}`);
    const reference = Object.values(workflow).find((node) => (
      node._meta?.title === G_PLUS_F_NODE_TITLES.reference
    ));

    expect(reference?.inputs.image).toBe(`input/${G_PLUS_F_STYLE_ASSET}`);
  });

  it("isolates the UXP style upload even when FormData renames the file to blob", () => {
    expect(gPlusFStyleUploadSubfolder(123))
      .toBe("ChessGo/GPlusF/style/123");
    expect(() => gPlusFStyleUploadSubfolder(-1)).toThrow("非负安全整数");
  });

  it("rejects a traversal path before queueing", () => {
    const workflow = JSON.parse(JSON.stringify(bundledWorkflow)) as ComfyWorkflow;
    expect(() => bindGPlusFStyleReference(workflow, "../secret.png"))
      .toThrow("输入路径无效");
  });
});
