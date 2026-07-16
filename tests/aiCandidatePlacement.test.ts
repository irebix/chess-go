import { describe, expect, it } from "vitest";
import {
  artboardBoundsFromDescriptor,
  calculateAiCandidatePlacement,
  rebaseTargetBoundsAfterArtboardShift
} from "../src/domain/aiCandidatePlacement";

describe("AI candidate Photoshop placement", () => {
  it("reads the native artboard rectangle instead of trusting an old overflowing layer", () => {
    expect(artboardBoundsFromDescriptor({
      artboard: {
        artboardRect: { left: 20, top: 40, right: 168, bottom: 188 }
      }
    })).toEqual({ left: 20, top: 40, right: 168, bottom: 188 });
  });

  it("fits a square candidate exactly into the original square artboard footprint", () => {
    const result = calculateAiCandidatePlacement(
      { left: 0, top: 0, right: 1024, bottom: 1024 },
      { left: 40, top: 70, right: 188, bottom: 218 }
    );
    expect(result.scale).toBe(148 / 1024);
    expect(result.targetCenterX).toBe(114);
    expect(result.targetCenterY).toBe(144);
  });

  it("contains a legacy non-square candidate without crossing the artboard edge", () => {
    const sourceWidth = 1024;
    const sourceHeight = 992;
    const result = calculateAiCandidatePlacement(
      { left: 0, top: 0, right: sourceWidth, bottom: sourceHeight },
      { left: 0, top: 0, right: 148, bottom: 148 }
    );
    expect(sourceWidth * result.scale).toBeLessThanOrEqual(148);
    expect(sourceHeight * result.scale).toBeLessThanOrEqual(148);
    expect(result.targetCenterX).toBe(74);
    expect(result.targetCenterY).toBe(74);
  });

  it("rebases a stale local target when replacement reveals the artboard document coordinates", () => {
    expect(rebaseTargetBoundsAfterArtboardShift(
      { left: 0, top: 0, right: 148, bottom: 148 },
      { left: 0, top: 0, right: 148, bottom: 148 },
      { left: 1732, top: 148, right: 1880, bottom: 296 }
    )).toEqual({ left: 1732, top: 148, right: 1880, bottom: 296 });
  });

  it("preserves a target inset while applying an artboard coordinate shift", () => {
    expect(rebaseTargetBoundsAfterArtboardShift(
      { left: 20, top: 30, right: 120, bottom: 130 },
      { left: 10, top: 10, right: 158, bottom: 158 },
      { left: 510, top: 210, right: 658, bottom: 358 }
    )).toEqual({ left: 520, top: 230, right: 620, bottom: 330 });
  });
});
