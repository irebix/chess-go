import { describe, expect, it } from "vitest";
import {
  collectHolopixImagesForPromptId,
  collectRecentHolopixImages
} from "../src/ai/holopixRecovery";

describe("Holopix candidate recovery", () => {
  it("does not mix a newer prompted batch with an older unrelated batch", () => {
    const recovered = collectRecentHolopixImages({
      older: { outputs: { "9": { images: [
        { filename: "c_cleaning1_00003_.png", subfolder: "Holopix\\ChessGo", type: "output" },
        { filename: "c_cleaning1_00003_.png", subfolder: "Holopix\\ChessGo", type: "output" }
      ] } } },
      newer: { outputs: {
        "9": { images: [
          { filename: "c_cleaning1_00005_.png", subfolder: "Holopix/ChessGo", type: "output" },
          { filename: "other_00001_.png", subfolder: "Holopix/ChessGo", type: "output" },
          { filename: "c_cleaning1_00006_.png", subfolder: "Holopix/ChessGo", type: "temp" }
        ] },
        "10": { text: ["cleaning cloth, game icon"] }
      } }
    }, ["c_cleaning1"], "http://127.0.0.1:8188");

    expect(recovered.c_cleaning1?.map((image) => image.filename)).toEqual(["c_cleaning1_00005_.png"]);
    expect(recovered.c_cleaning1?.[0]?.url).toContain("/view?");
    expect(recovered.c_cleaning1?.[0]?.promptText).toBe("cleaning cloth, game icon");
  });

  it("merges adjacent generation batches only when their captured prompts match", () => {
    const recovered = collectRecentHolopixImages({
      oldestDifferentPrompt: { outputs: {
        "9": { images: [
          { filename: "c_cleaning1_00002_.png", subfolder: "Holopix/ChessGo", type: "output" }
        ] },
        "10": { text: ["an unrelated old prompt"] }
      } },
      firstMatchingBatch: { outputs: {
        "9": { images: [
          { filename: "c_cleaning1_00003_.png", subfolder: "Holopix/ChessGo", type: "output" },
          { filename: "c_cleaning1_00004_.png", subfolder: "Holopix/ChessGo", type: "output" }
        ] },
        "10": { text: ["same cleaning cloth prompt"] }
      } },
      secondMatchingBatch: { outputs: {
        "9": { images: [
          { filename: "c_cleaning1_00005_.png", subfolder: "Holopix/ChessGo", type: "output" }
        ] },
        "10": { text: ["same cleaning cloth prompt"] }
      } }
    }, ["c_cleaning1"], "http://127.0.0.1:8188");

    expect(recovered.c_cleaning1?.map((image) => image.filename)).toEqual([
      "c_cleaning1_00005_.png",
      "c_cleaning1_00004_.png",
      "c_cleaning1_00003_.png"
    ]);
    expect(new Set(recovered.c_cleaning1?.map((image) => image.promptText))).toEqual(
      new Set(["same cleaning cloth prompt"])
    );
  });

  it("recovers a literal generation prompt from older prompt-only history", () => {
    const recovered = collectRecentHolopixImages({
      promptOnly: {
        prompt: [7, "client", {
          "7": { class_type: "HolopixGenerate", inputs: { prompt: "mop, square game icon" } }
        }],
        outputs: {
          "9": { images: [
            { filename: "c_cleaning6_00003_.png", subfolder: "Holopix/ChessGo", type: "output" }
          ] }
        }
      }
    }, ["c_cleaning6"], "http://127.0.0.1:8188");

    expect(recovered.c_cleaning6?.[0]?.promptText).toBe("mop, square game icon");
  });

  it("recovers QwenVL text recorded by the PreviewAny result node", () => {
    const recovered = collectRecentHolopixImages({
      qwen: { outputs: {
        "9": { images: [
          { filename: "c_cleaning3_00007_.png", subfolder: "Holopix/ChessGo", type: "output" }
        ] },
        "18": { value: ["一把绿色手柄的清洁刷，白色刷毛，等距视角。"] }
      } }
    }, ["c_cleaning3"], "http://127.0.0.1:8188");

    expect(recovered.c_cleaning3?.[0]?.promptText).toBe("一把绿色手柄的清洁刷，白色刷毛，等距视角。");
  });

  it("recovers an unknown paid result only from its exact prompt id", () => {
    const history = {
      oldPrompt: { outputs: { "9": { images: [
        { filename: "c_cleaning1_00008_.png", subfolder: "Holopix/ChessGo", type: "output" }
      ] } } },
      expectedPrompt: { outputs: { "9": { images: [
        { filename: "c_cleaning1_00009_.png", subfolder: "Holopix/ChessGo", type: "output" }
      ] } } }
    };

    expect(collectHolopixImagesForPromptId(
      history,
      "expectedPrompt",
      "c_cleaning1",
      "http://127.0.0.1:8188"
    ).map((image) => image.filename)).toEqual(["c_cleaning1_00009_.png"]);
    expect(collectHolopixImagesForPromptId(
      history,
      "missingPrompt",
      "c_cleaning1",
      "http://127.0.0.1:8188"
    )).toEqual([]);
  });
});
