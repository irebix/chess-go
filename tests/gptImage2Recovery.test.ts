import { describe, expect, it } from "vitest";
import {
  collectGptImage2ImagesForPromptId,
  collectRecentGptImage2Images
} from "../src/ai/gptImage2Recovery";

const baseUrl = "http://192.168.1.32:8188";

describe("GPT Image 2 candidate recovery", () => {
  it("maps saved whole-chain crops back to asset codes", () => {
    const history = {
      "prompt-new": entry(22, "200", [
        image("c_cleaning1.png", "Holopix/ChessGo/GptImage2/200"),
        image("c_cleaning2.png", "Holopix/ChessGo/GptImage2/200")
      ]),
      "prompt-old": entry(10, "100", [
        image("c_cleaning1.png", "Holopix/ChessGo/GptImage2/100")
      ])
    };
    const recovered = collectRecentGptImage2Images(
      history,
      ["c_cleaning1", "c_cleaning2"],
      baseUrl
    );
    expect(recovered.c_cleaning1?.map((item) => item.subfolder)).toEqual([
      "Holopix/ChessGo/GptImage2/200",
      "Holopix/ChessGo/GptImage2/100"
    ]);
    expect(recovered.c_cleaning2).toHaveLength(1);
  });

  it("recovers only the requested asset from a shared prompt id", () => {
    const history = {
      shared: entry(30, "300", [
        image("c_cleaning1.png", "Holopix/ChessGo/GptImage2/300"),
        image("c_cleaning2.png", "Holopix/ChessGo/GptImage2/300")
      ])
    };
    const images = collectGptImage2ImagesForPromptId(history, "shared", "c_cleaning2", baseUrl);
    expect(images).toHaveLength(1);
    expect(images[0]?.filename).toBe("c_cleaning2.png");
    expect(images[0]?.url).toContain("filename=c_cleaning2.png");
  });

  it("ignores similarly named outputs that are not from the semantic GPT Image 2 workflow", () => {
    const history = {
      flux: {
        prompt: [1, "client", {
          "4": { class_type: "HolopixGenerate", _meta: { title: "Flux" } }
        }],
        outputs: {
          "9": { images: [image("c_cleaning1.png", "Holopix/ChessGo/GptImage2/9")] }
        }
      }
    };
    expect(collectRecentGptImage2Images(history, ["c_cleaning1"], baseUrl).c_cleaning1).toEqual([]);
  });
});

function entry(sequence: number, subfolderSequence: string, images: ReturnType<typeof image>[]) {
  return {
    prompt: [sequence, "client", {
      "4": {
        class_type: "HolopixGenerateV3",
        _meta: { title: "GPT Image 2｜整链生成" }
      }
    }],
    outputs: {
      "9": {
        images: images.map((value) => ({
          ...value,
          subfolder: `Holopix/ChessGo/GptImage2/${subfolderSequence}`
        }))
      }
    }
  };
}

function image(filename: string, subfolder: string) {
  return { filename, subfolder, type: "output" };
}
