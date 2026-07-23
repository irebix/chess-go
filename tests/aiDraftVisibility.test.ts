import { describe, expect, it } from "vitest";
import { shouldShowAiDraftPanel } from "../src/domain/aiDraftVisibility";

describe("AI draft panel visibility", () => {
  it("shows only for an active artboard or initialized standard-grid document", () => {
    expect(shouldShowAiDraftPanel(null, "UNSUPPORTED_CANVAS")).toBe(false);
    expect(shouldShowAiDraftPanel(101, "UNSUPPORTED_CANVAS")).toBe(false);
    expect(shouldShowAiDraftPanel(101, "ARTBOARD")).toBe(true);
    expect(shouldShowAiDraftPanel(101, "STANDARD_GRID")).toBe(true);
  });
});
