import { describe, expect, it } from "vitest";
import { calculateContainTransform } from "../src/domain/contain";

describe("calculateContainTransform", () => {
  it("shrinks a wide image to the content box without upscaling", () => {
    const result = calculateContainTransform({
      source: { left: 0, top: 0, right: 292, bottom: 100 },
      maxWidth: 146,
      maxHeight: 134,
      targetCenterX: 74,
      targetCenterY: 78,
      allowUpscale: false
    });
    expect(result.scale).toBe(0.5);
  });

  it("keeps a small image at 100 percent when upscaling is disabled", () => {
    const result = calculateContainTransform({
      source: { left: 20, top: 30, right: 80, bottom: 90 },
      maxWidth: 146,
      maxHeight: 134,
      targetCenterX: 74,
      targetCenterY: 78,
      allowUpscale: false
    });
    expect(result.scale).toBe(1);
    expect(result.translateX).toBe(24);
    expect(result.translateY).toBe(18);
  });

  it("reserves a half-pixel envelope so saved integer bounds stay inside the content box", () => {
    const result = calculateContainTransform({
      source: { left: 0, top: 0, right: 146, bottom: 135 },
      maxWidth: 146,
      maxHeight: 134,
      targetCenterX: 74,
      targetCenterY: 78,
      allowUpscale: false,
      pixelEnvelopeMargin: 0.5
    });
    expect(146 * result.scale).toBeLessThanOrEqual(145.5);
    expect(135 * result.scale).toBeLessThanOrEqual(133.5);
  });

  it("scales the default 1024 square editable canvas to exactly 148 by 148", () => {
    const result = calculateContainTransform({
      source: { left: 0, top: 0, right: 1024, bottom: 1024 },
      maxWidth: 148,
      maxHeight: 148,
      targetCenterX: 74,
      targetCenterY: 74,
      allowUpscale: true
    });
    expect(result.scale).toBe(148 / 1024);
    expect(1024 * result.scale).toBe(148);
  });
});
