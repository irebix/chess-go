import { describe, expect, it } from "vitest";
import {
  assessHolopixPaidBatch,
  interpretHolopixHistoryEntry
} from "../src/ai/holopixGenerationResult";

const image = (filename: string) => ({ filename, subfolder: "Holopix/ChessGo", type: "output" });

describe("Holopix paid generation result handling", () => {
  it("waits while only part of a running batch has arrived", () => {
    expect(interpretHolopixHistoryEntry({
      outputs: {
        save: { images: [image("one.png")] },
        prompt: { text: ["same prompt"] }
      },
      status: { completed: false }
    }, "save", "prompt", 2)).toEqual({ kind: "pending" });
  });

  it("returns a complete running batch after all images and the prompt arrive", () => {
    expect(interpretHolopixHistoryEntry({
      outputs: {
        save: { images: [image("one.png"), image("two.png")] },
        prompt: { text: ["same prompt"] }
      }
    }, "save", "prompt", 2)).toMatchObject({
      kind: "complete",
      promptText: "same prompt",
      images: [{ filename: "one.png" }, { filename: "two.png" }]
    });
  });

  it("preserves paid images when prompt capture is missing at completion", () => {
    expect(interpretHolopixHistoryEntry({
      outputs: { save: { images: [image("paid.png")] } },
      status: { completed: true }
    }, "save", "prompt", 1)).toMatchObject({
      kind: "complete",
      images: [{ filename: "paid.png" }],
      terminalError: expect.stringContaining("提示词结果")
    });
  });

  it("returns a terminal partial batch so the caller can preserve it before failing the remainder", () => {
    expect(interpretHolopixHistoryEntry({
      outputs: {
        save: { images: [image("paid.png")] },
        prompt: { text: ["same prompt"] }
      },
      status: { completed: true }
    }, "save", "prompt", 2)).toMatchObject({
      kind: "complete",
      images: [{ filename: "paid.png" }],
      promptText: "same prompt"
    });
  });

  it("preserves paid images on execution_error but fails when no image exists", () => {
    const status = { messages: [["execution_error", { exception_message: "capture failed" }]] };
    expect(interpretHolopixHistoryEntry({
      outputs: { save: { images: [image("paid.png")] } },
      status
    }, "save", "prompt", 1)).toMatchObject({
      kind: "complete",
      images: [{ filename: "paid.png" }],
      terminalError: expect.stringContaining("capture failed")
    });
    expect(interpretHolopixHistoryEntry({ status }, "save", "prompt", 1)).toMatchObject({
      kind: "failed",
      error: expect.stringContaining("capture failed")
    });
  });

  it("treats status_str error as terminal even with a full prompted batch", () => {
    expect(interpretHolopixHistoryEntry({
      outputs: {
        save: { images: [image("paid.png")] },
        prompt: { text: ["same prompt"] }
      },
      status: { status_str: "error" }
    }, "save", "prompt", 1)).toMatchObject({
      kind: "complete",
      images: [{ filename: "paid.png" }],
      terminalError: expect.stringContaining("错误状态")
    });
  });

  it("keeps all paid images available even when the captured prompt mismatches", () => {
    const assessment = assessHolopixPaidBatch([
      { filename: "one.png", subfolder: "", type: "output", url: "one" },
      { filename: "two.png", subfolder: "", type: "output", url: "two" }
    ], 2, "first prompt", "unexpected prompt");

    expect(assessment.imagesToPreserve.map((entry) => entry.filename)).toEqual(["one.png", "two.png"]);
    expect(assessment.imagesToPreserve.every((entry) => entry.promptText === "first prompt")).toBe(true);
    expect(assessment.promptMismatchError).toContain("没有沿用");
  });
});
