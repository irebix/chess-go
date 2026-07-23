import { describe, expect, it } from "vitest";
import bundledWorkflow from "../Holopix.json";
import {
  assertHolopixWorkflow,
  describeHolopixPromptSource,
  prepareHolopixWorkflow,
  splitHolopixBatches,
  type ComfyWorkflow
} from "../src/ai/holopixWorkflow";

const workflow: ComfyWorkflow = {
  "5": { class_type: "HolopixModelStack", inputs: { model_id: 858, strength: 0.6 } },
  "7": {
    class_type: "HolopixGenerate",
    inputs: {
      aspect_ratio: "4:3",
      batch_size: "1",
      request_nonce: 0,
      confirm_cost: false,
      timeout_seconds: 175,
      prompt: ["12", 0],
      models: ["5", 0]
    }
  },
  "8": {
    class_type: "ImageScale",
    inputs: { image: ["7", 0], upscale_method: "nearest-exact", width: 768, height: 512, crop: "disabled" }
  },
  "19": {
    class_type: "BiRefNetRMBG",
    inputs: {
      image: ["8", 0],
      model: "BiRefNet_toonout",
      mask_blur: 0,
      mask_offset: 0,
      invert_output: false,
      refine_foreground: false,
      background: "Alpha"
    }
  },
  "9": { class_type: "SaveImage", inputs: { filename_prefix: "old", images: ["19", 0] } },
  "12": {
    class_type: "AILab_QwenVL",
    inputs: {
      image: ["16", 0],
      custom_prompt: ["14", 0],
      model_name: "Qwen3-VL-2B-Instruct"
    },
    _meta: { title: "QwenVL" }
  },
  "13": {
    class_type: "PrimitiveStringMultiline",
    inputs: { value: "old name" },
    _meta: { title: "物件名字输入" }
  },
  "14": {
    class_type: "StringFormat",
    inputs: { f_string: "对象名称：{a}", "values.a": ["13", 0] },
    _meta: { title: "格式化文本" }
  },
  "16": {
    class_type: "LoadImage",
    inputs: { image: "reference.png" },
    _meta: { title: "加载 Excel 参考图" }
  },
  "18": {
    class_type: "PreviewAny",
    inputs: { source: ["12", 0] },
    _meta: { title: "提示词结果" }
  }
};

describe("Holopix workflow adapter", () => {
  it("accepts the bundled QwenVL workflow template", () => {
    expect(() => assertHolopixWorkflow(bundledWorkflow)).not.toThrow();
    const generate = Object.values(bundledWorkflow).find((node) => node.class_type === "HolopixGenerate");
    const inputs = generate?.inputs as Record<string, unknown> | undefined;
    expect(inputs?.confirm_cost).toBe(true);
    expect(generate?.inputs).not.toHaveProperty("vip_channel");
    expect((bundledWorkflow as ComfyWorkflow)["19"]?.inputs).toMatchObject({
      image: ["8", 0],
      model: "BiRefNet_toonout",
      background: "Alpha"
    });
    expect((bundledWorkflow as ComfyWorkflow)["9"]?.inputs.images).toEqual(["19", 0]);
    expect(describeHolopixPromptSource(bundledWorkflow)).toMatchObject({
      kind: "node",
      label: "提示词结果"
    });
  });

  it("uses the requested two-model stack in order", () => {
    const bundled = bundledWorkflow as ComfyWorkflow;
    const modelNodes = Object.values(bundled).filter((node) => node.class_type === "HolopixModelStack");
    expect(modelNodes).toHaveLength(2);
    expect(bundled["3"]?.inputs).toMatchObject({ model_id: 858, strength: 0.6 });
    expect(bundled["3"]?.inputs).not.toHaveProperty("previous_models");
    expect(bundled["5"]?.inputs).toMatchObject({
      model_id: 6768,
      strength: 0.8,
      previous_models: ["3", 0]
    });
    expect(bundled["4"]).toBeUndefined();
    expect(bundled["7"]?.inputs.models).toEqual(["5", 0]);
  });

  it("injects the item name and reference into QwenVL while keeping generation prompt-only", () => {
    const prepared = prepareHolopixWorkflow(workflow, {
      imageName: "uploaded/reference.png",
      itemName: "清洁布",
      batchSize: 2,
      requestNonce: 123,
      confirmCost: true,
      filenamePrefix: "Holopix/ChessGo/c_cleaning1"
    });

    expect(prepared.workflow["16"]!.inputs.image).toBe("uploaded/reference.png");
    expect(prepared.workflow["13"]!.inputs.value).toBe("清洁布");
    expect(prepared.workflow["14"]!.inputs["values.a"]).toEqual(["13", 0]);
    expect(prepared.workflow["12"]!.inputs).toMatchObject({
      image: ["16", 0],
      custom_prompt: ["14", 0]
    });
    expect(prepared.workflow["7"]!.inputs).toMatchObject({
      aspect_ratio: "1:1",
      batch_size: "2",
      request_nonce: 123,
      confirm_cost: true,
      timeout_seconds: 175,
      prompt: ["12", 0]
    });
    expect(prepared.workflow["7"]!.inputs).not.toHaveProperty("reference");
    expect(prepared.workflow["8"]!.inputs).toMatchObject({
      image: ["7", 0],
      width: 1024,
      height: 1024,
      crop: "center"
    });
    expect(prepared.workflow["19"]!.inputs).toMatchObject({
      image: ["8", 0],
      model: "BiRefNet_toonout",
      background: "Alpha"
    });
    expect(prepared.workflow["9"]!.inputs.filename_prefix).toBe("Holopix/ChessGo/c_cleaning1");
    expect(prepared.workflow["9"]!.inputs.images).toEqual(["19", 0]);
    expect(prepared.workflow["18"]!.inputs.source).toEqual(["12", 0]);
    expect(prepared.promptCaptureNodeId).toBe("18");
    expect(workflow["13"]!.inputs.value).toBe("old name");
  });

  it("reports the QwenVL result node as the live prompt source", () => {
    expect(describeHolopixPromptSource(workflow)).toEqual({
      kind: "node",
      label: "提示词结果",
      detail: "等待生成或恢复后显示 QwenVL 返回的实际提示词（结果节点 18）。"
    });
  });

  it("uses a supplied prompt directly and removes the QwenVL execution path", () => {
    const prepared = prepareHolopixWorkflow(workflow, {
      batchSize: 1,
      requestNonce: 124,
      confirmCost: true,
      filenamePrefix: "Holopix/ChessGo/c_cleaning1",
      promptText: "same captured cleaning cloth prompt"
    });

    expect(prepared.workflow["7"]!.inputs.prompt).toBe("same captured cleaning cloth prompt");
    expect(prepared.workflow["18"]!.inputs.source).toBe("same captured cleaning cloth prompt");
    expect(prepared.workflow["7"]!.inputs).not.toHaveProperty("reference");
    const classes = Object.values(prepared.workflow).map((node) => node.class_type);
    expect(classes).not.toContain("LoadImage");
    expect(classes).not.toContain("PrimitiveStringMultiline");
    expect(classes).not.toContain("StringFormat");
    expect(classes).not.toContain("AILab_QwenVL");
  });

  it("requires both a reference image and an item name for QwenVL", () => {
    expect(() => prepareHolopixWorkflow(workflow, {
      imageName: "uploaded/reference.png",
      batchSize: 1,
      requestNonce: 124,
      confirmCost: true,
      filenamePrefix: "Holopix/ChessGo/c_cleaning1"
    })).toThrow(/缺少物品名称/);
  });

  it("splits unsupported three-image requests into valid Holopix batches", () => {
    expect(splitHolopixBatches(1)).toEqual([1]);
    expect(splitHolopixBatches(2)).toEqual([2]);
    expect(splitHolopixBatches(3)).toEqual([2, 1]);
    expect(splitHolopixBatches(4)).toEqual([4]);
  });

  it("rejects workflows with missing required node classes", () => {
    expect(() => assertHolopixWorkflow({})).toThrow(/LoadImage/);
  });

  it("rejects connecting a reference directly to HolopixGenerate", () => {
    const withImg2Img = JSON.parse(JSON.stringify(workflow)) as ComfyWorkflow;
    withImg2Img["7"]!.inputs.reference = ["16", 0];
    expect(() => assertHolopixWorkflow(withImg2Img)).toThrow(/不能连接 reference/);
  });

  it("rejects a generation prompt that bypasses QwenVL", () => {
    const literalPrompt = JSON.parse(JSON.stringify(workflow)) as ComfyWorkflow;
    literalPrompt["7"]!.inputs.prompt = "literal prompt";
    expect(() => assertHolopixWorkflow(literalPrompt)).toThrow(/必须连接 QwenVL/);
  });
});
