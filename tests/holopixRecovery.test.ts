import { describe, expect, it } from "vitest";
import { collectRecentHolopixImages } from "../src/ai/holopixRecovery";

describe("Holopix candidate recovery", () => {
  it("recovers only ChessGo output images and sorts newest first", () => {
    const recovered = collectRecentHolopixImages({
      older: { outputs: { "9": { images: [
        { filename: "c_cleaning1_00003_.png", subfolder: "Holopix\\ChessGo", type: "output" },
        { filename: "c_cleaning1_00003_.png", subfolder: "Holopix\\ChessGo", type: "output" }
      ] } } },
      newer: { outputs: { "9": { images: [
        { filename: "c_cleaning1_00005_.png", subfolder: "Holopix/ChessGo", type: "output" },
        { filename: "other_00001_.png", subfolder: "Holopix/ChessGo", type: "output" },
        { filename: "c_cleaning1_00006_.png", subfolder: "Holopix/ChessGo", type: "temp" }
      ] } } }
    }, ["c_cleaning1"], "http://127.0.0.1:8188");

    expect(recovered.c_cleaning1?.map((image) => image.filename)).toEqual([
      "c_cleaning1_00005_.png",
      "c_cleaning1_00003_.png"
    ]);
    expect(recovered.c_cleaning1?.[0]?.url).toContain("/view?");
  });
});
