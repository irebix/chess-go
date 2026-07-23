import { describe, expect, it } from "vitest";
import {
  collectGPlusFImagesForPromptId,
  collectRecentGPlusFImages,
  G_PLUS_F_GENERATE_TITLE
} from "../src/ai/gPlusFRecovery";

const baseUrl = "http://127.0.0.1:8188";
const prompt = (subfolder: string) => [
  "42",
  {},
  {
    "14": {
      class_type: "HolopixGenerate",
      _meta: { title: G_PLUS_F_GENERATE_TITLE }
    }
  },
  {},
  ["14"]
].map((value, index) => (
  index === 1
    ? {
        "9": {
          images: [{
            filename: "c_cleaning1.png",
            subfolder,
            type: "output"
          }]
        }
      }
    : value
));

describe("G+F recovery", () => {
  it("matches the per-item Holopix generation node title", () => {
    expect(G_PLUS_F_GENERATE_TITLE).toBe("G+F｜Holopix 单图细化");
  });

  it("only recovers final G+F named outputs", () => {
    const history = {
      "g-plus-f": {
        prompt: prompt("Holopix/ChessGo/GPlusF/42"),
        outputs: {
          "9": {
            images: [{
              filename: "c_cleaning1.png",
              subfolder: "Holopix/ChessGo/GPlusF/42",
              type: "output"
            }]
          }
        }
      },
      "gpt-only": {
        prompt: [
          "41",
          {},
          {
            "4": {
              class_type: "HolopixGenerateV3",
              _meta: { title: "GPT Image 2｜整链生成" }
            }
          }
        ],
        outputs: {
          "9": {
            images: [{
              filename: "c_cleaning1.png",
              subfolder: "Holopix/ChessGo/GptImage2/41",
              type: "output"
            }]
          }
        }
      }
    };

    expect(collectRecentGPlusFImages(history, ["c_cleaning1"], baseUrl).c_cleaning1)
      .toHaveLength(1);
    expect(collectGPlusFImagesForPromptId(
      history,
      "gpt-only",
      "c_cleaning1",
      baseUrl
    )).toEqual([]);
  });
});
