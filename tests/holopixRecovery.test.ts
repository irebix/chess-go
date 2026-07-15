import { describe, expect, it } from "vitest";
import { collectRecentHolopixImages } from "../src/ai/holopixRecovery";

describe("Holopix candidate recovery", () => {
  it("recovers only ChessGo output images and sorts newest first", () => {
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

    expect(recovered.c_cleaning1?.map((image) => image.filename)).toEqual([
      "c_cleaning1_00005_.png",
      "c_cleaning1_00003_.png"
    ]);
    expect(recovered.c_cleaning1?.[0]?.url).toContain("/view?");
    expect(recovered.c_cleaning1?.[0]?.promptText).toBe("cleaning cloth, game icon");
    expect(recovered.c_cleaning1?.[1]?.promptText).toBeUndefined();
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
});
