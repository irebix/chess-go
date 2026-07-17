import { describe, expect, it } from "vitest";
import {
  aiCandidateMatrixWidth,
  clampAiMatrixScrollLeft,
  shouldForwardMatrixWheel
} from "../src/domain/aiMatrixLayout";

describe("AI candidate matrix layout", () => {
  it("expands the row background to cover every candidate slot", () => {
    expect(aiCandidateMatrixWidth(1)).toBe(350);
    expect(aiCandidateMatrixWidth(2)).toBe(350);
    expect(aiCandidateMatrixWidth(3)).toBe(396);
    expect(aiCandidateMatrixWidth(4)).toBe(467);
    expect(aiCandidateMatrixWidth(6)).toBe(609);
  });

  it("forwards only ordinary vertical wheel movement to the outer panel", () => {
    expect(shouldForwardMatrixWheel(0, 120, false)).toBe(true);
    expect(shouldForwardMatrixWheel(120, 20, false)).toBe(false);
    expect(shouldForwardMatrixWheel(0, 120, true)).toBe(false);
  });

  it("clamps the real viewport scroll offset to the visible matrix range", () => {
    expect(clampAiMatrixScrollLeft(180, 609, 350)).toBe(180);
    expect(clampAiMatrixScrollLeft(500, 609, 350)).toBe(259);
    expect(clampAiMatrixScrollLeft(80, 350, 350)).toBe(0);
    expect(clampAiMatrixScrollLeft(-20, 609, 350)).toBe(0);
    expect(clampAiMatrixScrollLeft(Number.NaN, 609, 350)).toBe(0);
  });
});
