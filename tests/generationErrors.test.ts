import { describe, expect, it } from "vitest";
import { UserCancelledError } from "../src/utils/errors";
import { isCancellationError, normalizeGenerationError } from "../src/utils/generationErrors";

describe("generation error normalization", () => {
  it("converts plugin cancellation into a progress-aware user cancellation", () => {
    const normalized = normalizeGenerationError(new UserCancelledError(), 10, 43);
    expect(normalized).toBeInstanceOf(UserCancelledError);
    expect((normalized as Error).message).toBe("已取消生成，完成 10/43。");
  });

  it("recognizes Photoshop host cancellation variants", () => {
    expect(isCancellationError(new Error("The command was cancelled"))).toBe(true);
    expect(isCancellationError(new Error("User cancelled the operation (-128)"))).toBe(true);
  });

  it("preserves unrelated generation errors", () => {
    const original = new Error("图片置入失败");
    expect(normalizeGenerationError(original, 3, 43)).toBe(original);
  });
});
