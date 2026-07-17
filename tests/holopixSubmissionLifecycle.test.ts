import { describe, expect, it, vi } from "vitest";
import { notifyHolopixSubmissionLifecycle } from "../src/ai/holopixSubmissionLifecycle";

const baseEvent = {
  submissionKey: "request-42",
  completedBeforeBatch: 0,
  batchSize: 2,
  createdAt: 123
};

describe("Holopix submission lifecycle", () => {
  it("hard-blocks a paid request when its started record cannot be persisted", () => {
    expect(() => notifyHolopixSubmissionLifecycle(
      () => { throw new Error("storage full"); },
      { state: "started", ...baseEvent }
    )).toThrow(/付费生成请求未发送.*storage full/);
  });

  it("warns without hiding an already submitted confirmed/resolved result", () => {
    const warning = vi.fn();
    expect(() => notifyHolopixSubmissionLifecycle(
      () => { throw new Error("storage full"); },
      { state: "confirmed", ...baseEvent, promptId: "prompt-42" },
      warning
    )).not.toThrow();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("storage full"));
  });
});
