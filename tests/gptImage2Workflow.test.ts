import { describe, expect, it } from "vitest";
import bundledWorkflow from "../GptImage2.json";
import {
  assertGptImage2Workflow,
  buildGptImage2Prompt,
  GPT_IMAGE_2_NODE_TITLES,
  gptImage2AspectRatio,
  prepareGptImage2Workflow,
  type GptImage2WorkflowItem
} from "../src/ai/gptImage2Workflow";
import type { ComfyWorkflow } from "../src/ai/holopixWorkflow";

const items: GptImage2WorkflowItem[] = [
  { assetCode: "food_01", itemName: "釜山小麦面" },
  { assetCode: "food_02", itemName: "辣拌冷面", promptText: "红色辣酱拌冷面，白瓷碗" }
];

describe("GPT Image 2 whole-chain workflow adapter", () => {
  it("accepts the bundled semantic-title workflow", () => {
    expect(() => assertGptImage2Workflow(bundledWorkflow)).not.toThrow();
    const generate = titledNode(bundledWorkflow, GPT_IMAGE_2_NODE_TITLES.generate);
    expect(generate.inputs.vip_channel).toBe(true);
    expect(generate.inputs).not.toHaveProperty("confirm_cost");
  });

  it("injects an ordered item list while preserving the workflow-owned style reference", () => {
    const prepared = prepareGptImage2Workflow(bundledWorkflow, {
      items,
      requestNonce: 42,
      outputSubfolder: "Holopix/ChessGo/GptImage2/42"
    });
    const reference = titledNode(prepared.workflow, GPT_IMAGE_2_NODE_TITLES.reference);
    const prompt = titledNode(prepared.workflow, GPT_IMAGE_2_NODE_TITLES.itemPrompt);
    const names = titledNode(prepared.workflow, GPT_IMAGE_2_NODE_TITLES.outputNames);
    const generate = titledNode(prepared.workflow, GPT_IMAGE_2_NODE_TITLES.generate);
    const crop = titledNode(prepared.workflow, GPT_IMAGE_2_NODE_TITLES.crop);
    const save = titledNode(prepared.workflow, GPT_IMAGE_2_NODE_TITLES.save);

    expect(reference.inputs.image).toBe("鸡尾酒24_2_看图王.jpg");
    expect(prompt.inputs.value).toContain("1. 釜山小麦面");
    expect(prompt.inputs.value).toContain("2. 红色辣酱拌冷面，白瓷碗");
    expect(prompt.inputs.value).toContain("不要出现任何文字");
    expect(names.inputs.value).toBe('["food_01","food_02"]');
    expect(generate.inputs).toMatchObject({
      aspect_ratio: "4:3",
      batch_size: "1",
      request_nonce: 42,
      vip_channel: true
    });
    expect(generate.inputs).not.toHaveProperty("confirm_cost");
    expect(crop.inputs.max_objects).toBe(2);
    expect(save.inputs).toMatchObject({
      subfolder: "Holopix/ChessGo/GptImage2/42",
      collision_policy: "overwrite"
    });
  });

  it("finds injection points by semantic titles after node IDs are renumbered", () => {
    const remapped = remapNodeIds(bundledWorkflow, 100);
    const prepared = prepareGptImage2Workflow(remapped, {
      items: [items[0]!],
      requestNonce: 9,
      outputSubfolder: "Holopix/ChessGo/GptImage2/9"
    });
    expect(prepared.saveNodeId).toBe("109");
    expect(titledNode(prepared.workflow, GPT_IMAGE_2_NODE_TITLES.generate).inputs.aspect_ratio).toBe("1:1");
  });

  it("chooses canvas ratios for the supported whole-chain sizes", () => {
    expect([1, 2, 4, 6, 9, 12, 64].map(gptImage2AspectRatio)).toEqual([
      "1:1", "4:3", "1:1", "3:4", "1:1", "4:5", "1:1"
    ]);
    expect(buildGptImage2Prompt(items)).toContain("固定排成 2 列 × 1 行");
  });
});

function titledNode(workflow: ComfyWorkflow, title: string) {
  return Object.values(workflow).find((node) => node._meta?.title === title)!;
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
