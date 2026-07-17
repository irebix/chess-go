import { describe, expect, it, vi } from "vitest";
import {
  assertExpectedDocumentId,
  assertSingleBatchPlaySucceeded,
  runWithRollbackHistory
} from "../src/photoshop/aiCandidateBackfillSafety";

describe("AI candidate backfill safety", () => {
  it("rejects a different or unavailable active document", () => {
    expect(() => assertExpectedDocumentId(42, 42, "下载前，")).not.toThrow();
    expect(() => assertExpectedDocumentId(42, 84, "下载前，")).toThrow(
      "下载前，当前 PSD 与候选所属 PSD 不一致（预期文档 42，当前 84）"
    );
    expect(() => assertExpectedDocumentId(42, undefined, "modal 内，")).toThrow(
      "modal 内，当前 PSD 与候选所属 PSD 不一致（预期文档 42，当前 无）"
    );
  });

  it("accepts a normal batchPlay result and Photoshop's zero-valued error descriptor", () => {
    expect(() => assertSingleBatchPlaySucceeded([{}], "选择图层")).not.toThrow();
    expect(() => assertSingleBatchPlaySucceeded([{ _obj: "error", result: 0 }], "选择图层")).not.toThrow();
  });

  it("reports batchPlay error descriptors instead of treating replacement as successful", () => {
    expect(() => assertSingleBatchPlaySucceeded(
      [{ _obj: "error", result: -128, message: "用户取消了命令" }],
      "替换智能对象内容"
    )).toThrow("替换智能对象内容失败：用户取消了命令");
    expect(() => assertSingleBatchPlaySucceeded([], "选择回填智能对象")).toThrow(
      "Photoshop 未返回预期的执行结果"
    );
  });

  it("commits one suspended history state after a successful replacement", async () => {
    const suspension = { id: "history-1" };
    const hostControl = {
      suspendHistory: vi.fn().mockResolvedValue(suspension),
      resumeHistory: vi.fn().mockResolvedValue(undefined)
    };

    await expect(runWithRollbackHistory(
      hostControl,
      { documentID: 42, name: "回填候选" },
      async () => "applied"
    )).resolves.toBe("applied");
    expect(hostControl.suspendHistory).toHaveBeenCalledWith({ documentID: 42, name: "回填候选" });
    expect(hostControl.resumeHistory).toHaveBeenCalledTimes(1);
    expect(hostControl.resumeHistory).toHaveBeenCalledWith(suspension, true);
  });

  it("rolls back the suspended history state and preserves the original failure", async () => {
    const failure = new Error("最终几何溢出");
    const suspension = { id: "history-2" };
    const hostControl = {
      suspendHistory: vi.fn().mockResolvedValue(suspension),
      resumeHistory: vi.fn().mockResolvedValue(undefined)
    };

    await expect(runWithRollbackHistory(
      hostControl,
      { documentID: 42, name: "回填候选" },
      async () => { throw failure; }
    )).rejects.toBe(failure);
    expect(hostControl.resumeHistory).toHaveBeenCalledTimes(1);
    expect(hostControl.resumeHistory).toHaveBeenCalledWith(suspension, false);
  });

  it("reports both the operation and rollback errors when Photoshop cannot roll back", async () => {
    const hostControl = {
      suspendHistory: vi.fn().mockResolvedValue("history-3"),
      resumeHistory: vi.fn().mockRejectedValue(new Error("历史状态已失效"))
    };

    await expect(runWithRollbackHistory(
      hostControl,
      { documentID: 42, name: "回填候选" },
      async () => { throw new Error("替换失败"); }
    )).rejects.toThrow("替换失败；Photoshop 回滚失败：历史状态已失效");
  });

  it("attempts rollback when committing the suspended history state fails", async () => {
    const hostControl = {
      suspendHistory: vi.fn().mockResolvedValue("history-4"),
      resumeHistory: vi.fn()
        .mockRejectedValueOnce(new Error("提交历史失败"))
        .mockResolvedValueOnce(undefined)
    };

    await expect(runWithRollbackHistory(
      hostControl,
      { documentID: 42, name: "回填候选" },
      async () => "applied"
    )).rejects.toThrow("提交历史失败");
    expect(hostControl.resumeHistory).toHaveBeenNthCalledWith(1, "history-4", true);
    expect(hostControl.resumeHistory).toHaveBeenNthCalledWith(2, "history-4", false);
  });
});
