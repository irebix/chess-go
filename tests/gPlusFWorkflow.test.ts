import { describe, expect, it } from "vitest";
import bundledWorkflow from "../GPlusF.json";
import holopixWorkflow from "../Holopix.json";
import {
  assertGPlusFWorkflow,
  buildGPlusFItemRefinementPrompt,
  buildGPlusFRefinementPrompts,
  G_PLUS_F_ITEM_MARKER,
  G_PLUS_F_NODE_TITLES,
  G_PLUS_F_REFERENCE_WEIGHT,
  gPlusFPerItemRequestNonces,
  prepareGPlusFWorkflow,
  type GPlusFWorkflowItem
} from "../src/ai/gPlusFWorkflow";
import type { ComfyWorkflow, ComfyWorkflowNode } from "../src/ai/holopixWorkflow";

const items: GPlusFWorkflowItem[] = [
  { assetCode: "food_01", itemName: "釜山小麦面" },
  { assetCode: "food_02", itemName: "辣拌冷面", promptText: "红色辣酱拌冷面，白瓷碗" }
];

describe("G+F per-item GPT sheet → Holopix workflow adapter", () => {
  it("accepts the bundled guarded single-item template and its Holopix parity", () => {
    expect(() => assertGPlusFWorkflow(bundledWorkflow, holopixWorkflow)).not.toThrow();

    const workflow = bundledWorkflow as ComfyWorkflow;
    const styleReference = titledNode(workflow, G_PLUS_F_NODE_TITLES.reference);
    const gpt = titledNode(workflow, G_PLUS_F_NODE_TITLES.gptGenerate);
    const crop = titledNode(workflow, G_PLUS_F_NODE_TITLES.crop);
    const guard = titledNode(workflow, G_PLUS_F_NODE_TITLES.cropCountGuard);
    const selector = titledNode(workflow, G_PLUS_F_NODE_TITLES.selectCrop);
    const upload = titledNode(workflow, G_PLUS_F_NODE_TITLES.uploadReference);
    const prompt = titledNode(workflow, G_PLUS_F_NODE_TITLES.refinementPrompt);
    const primary = titledNode(workflow, G_PLUS_F_NODE_TITLES.modelPrimary);
    const secondary = titledNode(workflow, G_PLUS_F_NODE_TITLES.modelSecondary);
    const generate = titledNode(workflow, G_PLUS_F_NODE_TITLES.holopixGenerate);
    const removeBackground = titledNode(
      workflow,
      G_PLUS_F_NODE_TITLES.removeBackground
    );
    const rawSave = titledNode(workflow, G_PLUS_F_NODE_TITLES.rawSave);

    expect(styleReference.node.inputs.image).toBe("ImageRefinerStyle.png");
    expect(rawSave.node.inputs.images).toEqual([gpt.id, 0]);
    expect(crop.node.inputs.image).toEqual([gpt.id, 0]);
    expect(guard.node.inputs).toMatchObject({
      image: [crop.id, 0],
      crop_info: [crop.id, 2]
    });
    expect(selector.node.inputs).toMatchObject({
      image: [guard.id, 0],
      batch_index: 0,
      length: 1
    });
    expect(upload.node.inputs.image).toEqual([selector.id, 0]);
    expect(prompt.node.inputs.value).toContain(G_PLUS_F_ITEM_MARKER);
    expect(generate.node.inputs).toMatchObject({
      prompt: [prompt.id, 0],
      models: [secondary.id, 0],
      reference: [upload.id, 0],
      reference_weight: G_PLUS_F_REFERENCE_WEIGHT,
      aspect_ratio: "1:1",
      batch_size: "1"
    });
    expect(primary.node.inputs).toMatchObject({ model_id: 858, strength: 0.6 });
    expect(primary.node.inputs).not.toHaveProperty("previous_models");
    expect(secondary.node.inputs).toMatchObject({
      model_id: 6768,
      strength: 0.8,
      previous_models: [primary.id, 0]
    });
    expect(removeBackground.node.inputs.image).toEqual([generate.id, 0]);
  });

  it("builds two isolated paid branches behind the count guard and merges results in item order", () => {
    const prepared = prepareGPlusFWorkflow(bundledWorkflow, {
      items,
      gptRequestNonce: 41,
      holopixRequestNonce: 42,
      outputSubfolder: "Holopix\\ChessGo\\GPlusF\\42\\"
    }, holopixWorkflow);
    const workflow = prepared.workflow;
    const gpt = titledNode(workflow, G_PLUS_F_NODE_TITLES.gptGenerate);
    const crop = titledNode(workflow, G_PLUS_F_NODE_TITLES.crop);
    const guard = titledNode(workflow, G_PLUS_F_NODE_TITLES.cropCountGuard);
    const removeBackground = titledNode(
      workflow,
      G_PLUS_F_NODE_TITLES.removeBackground
    );
    const rawSave = titledNode(workflow, G_PLUS_F_NODE_TITLES.rawSave);
    const save = titledNode(workflow, G_PLUS_F_NODE_TITLES.save);
    const selectors = prepared.cropSelectorNodeIds.map((id) => requiredNode(workflow, id));
    const uploads = prepared.uploadReferenceNodeIds.map((id) => requiredNode(workflow, id));
    const generates = prepared.holopixGenerateNodeIds.map((id) => requiredNode(workflow, id));
    const prompts = nodesOfClass(workflow, "PrimitiveStringMultiline")
      .filter((entry) => entry.node._meta?.title?.startsWith(G_PLUS_F_NODE_TITLES.refinementPrompt))
      .sort(byNumericId);
    const sequenceGates = titledNodesStartingWith(workflow, "G+F｜逐图顺序门");
    const resultMerges = titledNodesStartingWith(workflow, "G+F｜逐图结果合批");

    expect(gpt.node.inputs).toMatchObject({
      aspect_ratio: "4:3",
      batch_size: "1",
      request_nonce: 41,
      vip_channel: true
    });
    expect(crop.node.inputs.max_objects).toBe(2);
    expect(guard.node.inputs).toMatchObject({
      expected_count: 2,
      image: [crop.id, 0],
      crop_info: [crop.id, 2]
    });
    expect(selectors).toHaveLength(2);
    expect(uploads).toHaveLength(2);
    expect(generates).toHaveLength(2);
    expect(prompts).toHaveLength(2);
    expect(selectors.map((entry) => entry.node.inputs.batch_index)).toEqual([0, 1]);
    expect(selectors.map((entry) => entry.node.inputs.length)).toEqual([1, 1]);
    expect(selectors[0]!.node.inputs.image).toEqual([guard.id, 0]);

    expect(sequenceGates).toHaveLength(1);
    expect(sequenceGates[0]!.node.class_type).toBe("ImageBatch");
    expect(sequenceGates[0]!.node.inputs).toEqual({
      image1: [guard.id, 0],
      image2: [prepared.holopixGenerateNodeIds[0], 0]
    });
    expect(selectors[1]!.node.inputs.image).toEqual([sequenceGates[0]!.id, 0]);

    for (let index = 0; index < 2; index += 1) {
      expect(uploads[index]!.node.inputs.image).toEqual([
        prepared.cropSelectorNodeIds[index],
        0
      ]);
      expect(generates[index]!.node.inputs).toMatchObject({
        prompt: [prompts[index]!.id, 0],
        reference: [prepared.uploadReferenceNodeIds[index], 0],
        aspect_ratio: "1:1",
        batch_size: "1",
        request_nonce: 42 + index,
        reference_weight: 0.2
      });
    }
    expect(prepared.refinementPromptTexts[0]).toContain("第 1/2 件");
    expect(prepared.refinementPromptTexts[0]).toContain("釜山小麦面");
    expect(prepared.refinementPromptTexts[1]).toContain("第 2/2 件");
    expect(prepared.refinementPromptTexts[1]).toContain("红色辣酱拌冷面，白瓷碗");

    expect(resultMerges).toHaveLength(1);
    expect(resultMerges[0]!.node.class_type).toBe("ImageBatch");
    expect(resultMerges[0]!.node.inputs).toEqual({
      image1: [prepared.holopixGenerateNodeIds[0], 0],
      image2: [prepared.holopixGenerateNodeIds[1], 0]
    });
    expect(prepared.finalRefinedBatchNodeId).toBe(resultMerges[0]!.id);
    expect(removeBackground.node.inputs.image).toEqual([resultMerges[0]!.id, 0]);
    expect(rawSave.node.inputs.filename_prefix).toBe(
      "Holopix/ChessGo/GPlusF/42/checkpoints/gpt_raw"
    );
    expect(save.node.inputs).toMatchObject({
      names: [crop.id, 1],
      subfolder: "Holopix/ChessGo/GPlusF/42",
      collision_policy: "overwrite"
    });
    expect(prepared).toMatchObject({
      saveNodeId: save.id,
      rawSaveNodeId: rawSave.id,
      gptGenerateNodeId: gpt.id,
      holopixGenerateNodeId: prepared.holopixGenerateNodeIds[0],
      timeoutSeconds: 450,
      outputNames: ["food_01", "food_02"]
    });
  });

  it("synchronizes Holopix models and safe fixed fields but forces every item to batch=1 and 1:1", () => {
    const source = cloneWorkflow(holopixWorkflow as ComfyWorkflow);
    source["3"]!.inputs.model_id = 9001;
    source["3"]!.inputs.strength = 0.25;
    source["5"]!.inputs.model_id = 9002;
    source["5"]!.inputs.strength = 0.75;
    source["7"]!.inputs.aspect_ratio = "4:3";
    source["7"]!.inputs.batch_size = "4";
    source["7"]!.inputs.confirm_cost = false;
    source["7"]!.inputs.timeout_seconds = 175;

    const prepared = prepareGPlusFWorkflow(bundledWorkflow, {
      items,
      gptRequestNonce: 61,
      holopixRequestNonce: 62,
      outputSubfolder: "Holopix/ChessGo/GPlusF/62"
    }, source);
    const primary = titledNode(prepared.workflow, G_PLUS_F_NODE_TITLES.modelPrimary);
    const secondary = titledNode(prepared.workflow, G_PLUS_F_NODE_TITLES.modelSecondary);

    expect(primary.node.inputs).toMatchObject({ model_id: 9001, strength: 0.25 });
    expect(secondary.node.inputs).toMatchObject({
      model_id: 9002,
      strength: 0.75,
      previous_models: [primary.id, 0]
    });
    for (const id of prepared.holopixGenerateNodeIds) {
      expect(requiredNode(prepared.workflow, id).node.inputs).toMatchObject({
        models: [secondary.id, 0],
        aspect_ratio: "1:1",
        batch_size: "1",
        confirm_cost: false,
        timeout_seconds: 175,
        reference_weight: 0.2
      });
    }
    expect(prepared.timeoutSeconds).toBe(500);
  });

  it("finds the template semantically after every static node ID is renumbered", () => {
    const remapped = remapNodeIds(bundledWorkflow as ComfyWorkflow, 100);
    const prepared = prepareGPlusFWorkflow(remapped, {
      items,
      gptRequestNonce: 81,
      holopixRequestNonce: 82,
      outputSubfolder: "Holopix/ChessGo/GPlusF/82"
    }, holopixWorkflow);

    expect(prepared.saveNodeId).toBe("109");
    expect(prepared.rawSaveNodeId).toBe("110");
    expect(prepared.gptGenerateNodeId).toBe("104");
    expect(prepared.holopixGenerateNodeIds).toEqual(["116", "122"]);
    expect(prepared.cropSelectorNodeIds).toEqual(["111", "119"]);
    expect(prepared.uploadReferenceNodeIds).toEqual(["112", "120"]);
    expect(prepared.finalRefinedBatchNodeId).toBe("123");
    expect(requiredNode(prepared.workflow, "117").node.inputs.expected_count).toBe(2);
    expect(requiredNode(prepared.workflow, "123").node.inputs).toEqual({
      image1: ["116", 0],
      image2: ["122", 0]
    });
  });

  it("rejects guard bypasses, whole-sheet upload, unsafe single-image settings, model drift, and nonce collisions", () => {
    const guardBypass = cloneWorkflow(bundledWorkflow as ComfyWorkflow);
    guardBypass["11"]!.inputs.image = ["5", 0];
    expect(() => assertGPlusFWorkflow(guardBypass)).toThrow(/通过数量校验/);

    const unguardedPaidBranch = cloneWorkflow(bundledWorkflow as ComfyWorkflow);
    unguardedPaidBranch["17"]!.inputs.image = ["4", 0];
    expect(() => assertGPlusFWorkflow(unguardedPaidBranch)).toThrow(/付费 Holopix 分支前/);

    const hiddenOverDetection = cloneWorkflow(bundledWorkflow as ComfyWorkflow);
    delete hiddenOverDetection["17"]!.inputs.crop_info;
    expect(() => assertGPlusFWorkflow(hiddenOverDetection)).toThrow(/截断前的检测数量/);

    const wholeSheetUpload = cloneWorkflow(bundledWorkflow as ComfyWorkflow);
    wholeSheetUpload["12"]!.inputs.image = ["4", 0];
    expect(() => assertGPlusFWorkflow(wholeSheetUpload)).toThrow(/单张 GPT 裁切图/);

    for (const [inputName, unsafeValue, message] of [
      ["reference_weight", 0.8, /权重必须固定为 0.2/],
      ["batch_size", "2", /batch_size 必须固定为 1/],
      ["aspect_ratio", "4:3", /aspect_ratio 必须固定为 1:1/]
    ] as const) {
      const unsafe = cloneWorkflow(bundledWorkflow as ComfyWorkflow);
      unsafe["16"]!.inputs[inputName] = unsafeValue;
      expect(() => assertGPlusFWorkflow(unsafe)).toThrow(message);
    }

    const modelDrift = cloneWorkflow(bundledWorkflow as ComfyWorkflow);
    modelDrift["14"]!.inputs.model_id = 9999;
    expect(() => assertGPlusFWorkflow(modelDrift)).toThrow(/两模型链/);

    expect(() => prepareGPlusFWorkflow(bundledWorkflow, {
      items,
      gptRequestNonce: 42,
      holopixRequestNonce: 41,
      outputSubfolder: "Holopix/ChessGo/GPlusF/nonce-conflict"
    })).toThrow(/不能与任何逐图 Holopix nonce 重复/);
    expect(() => gPlusFPerItemRequestNonces(Number.MAX_SAFE_INTEGER, 2)).toThrow(
      /超出安全整数范围/
    );
  });

  it("creates one item-specific prompt and one stable nonce per cropped object", () => {
    const prompts = buildGPlusFRefinementPrompts(items);
    expect(prompts).toHaveLength(2);
    expect(prompts[0]).toContain("第 1/2 件单图；目标物品：釜山小麦面");
    expect(prompts[1]).toContain("第 2/2 件单图；目标物品：红色辣酱拌冷面，白瓷碗");
    expect(prompts[0]).not.toBe(prompts[1]);
    expect(buildGPlusFItemRefinementPrompt(items[0]!, 0, 2, "只处理：{{CHESS_GO_ITEM}}"))
      .toBe("只处理：这是第 1/2 件单图；目标物品：釜山小麦面");
    expect(gPlusFPerItemRequestNonces(100, 3, 99)).toEqual([100, 101, 102]);
  });
});

interface NodeEntry {
  id: string;
  node: ComfyWorkflowNode;
}

function titledNode(workflow: ComfyWorkflow, title: string): NodeEntry {
  const entry = Object.entries(workflow).find(([, node]) => node._meta?.title === title);
  if (!entry) throw new Error(`Missing titled node: ${title}`);
  return { id: entry[0], node: entry[1] };
}

function titledNodesStartingWith(workflow: ComfyWorkflow, prefix: string): NodeEntry[] {
  return Object.entries(workflow)
    .filter(([, node]) => node._meta?.title?.startsWith(prefix))
    .map(([id, node]) => ({ id, node }))
    .sort(byNumericId);
}

function nodesOfClass(workflow: ComfyWorkflow, classType: string): NodeEntry[] {
  return Object.entries(workflow)
    .filter(([, node]) => node.class_type === classType)
    .map(([id, node]) => ({ id, node }));
}

function requiredNode(workflow: ComfyWorkflow, id: string): NodeEntry {
  const node = workflow[id];
  if (!node) throw new Error(`Missing node: ${id}`);
  return { id, node };
}

function byNumericId(left: NodeEntry, right: NodeEntry): number {
  return Number(left.id) - Number(right.id);
}

function remapNodeIds(workflow: ComfyWorkflow, offset: number): ComfyWorkflow {
  const idMap = new Map(Object.keys(workflow).map((id) => [id, String(Number(id) + offset)]));
  return Object.fromEntries(Object.entries(workflow).map(([id, node]) => [
    idMap.get(id)!,
    {
      ...node,
      inputs: Object.fromEntries(Object.entries(node.inputs).map(([name, value]) => [
        name,
        Array.isArray(value) && idMap.has(String(value[0]))
          ? [idMap.get(String(value[0]))!, value[1]]
          : value
      ]))
    }
  ]));
}

function cloneWorkflow(workflow: ComfyWorkflow): ComfyWorkflow {
  return JSON.parse(JSON.stringify(workflow)) as ComfyWorkflow;
}
