import type { ComfyWorkflow, ComfyWorkflowNode } from "./holopixWorkflow";

export const GPT_IMAGE_2_NODE_TITLES = {
  reference: "GPT Image 2｜风格参考图",
  itemPrompt: "GPT Image 2｜整链提示词",
  outputNames: "GPT Image 2｜输出名称",
  generate: "GPT Image 2｜整链生成",
  crop: "GPT Image 2｜按顺序裁切",
  save: "GPT Image 2｜保存候选"
} as const;

export const GPT_IMAGE_2_ITEMS_MARKER = "{{CHESS_GO_ITEMS}}";

export interface GptImage2WorkflowItem {
  assetCode: string;
  itemName: string;
  promptText?: string;
}

export interface GptImage2WorkflowOverrides {
  items: GptImage2WorkflowItem[];
  requestNonce: number;
  confirmCost: boolean;
  outputSubfolder: string;
}

export interface PreparedGptImage2Workflow {
  workflow: ComfyWorkflow;
  saveNodeId: string;
  timeoutSeconds: number;
  promptText: string;
  outputNames: string[];
}

interface FoundNode {
  id: string;
  node: ComfyWorkflowNode;
}

export function prepareGptImage2Workflow(
  baseWorkflow: ComfyWorkflow,
  options: GptImage2WorkflowOverrides
): PreparedGptImage2Workflow {
  assertGptImage2Workflow(baseWorkflow);
  if (!options.items.length) throw new Error("GPT Image 2 整链至少需要 1 个物品。");
  if (options.items.length > 64) throw new Error("GPT Image 2 单次整链最多支持 64 个物品。");

  const workflow = cloneWorkflow(baseWorkflow);
  const reference = findTitledNode(workflow, GPT_IMAGE_2_NODE_TITLES.reference, "LoadImage");
  const itemPrompt = findTitledNode(
    workflow,
    GPT_IMAGE_2_NODE_TITLES.itemPrompt,
    "PrimitiveStringMultiline"
  );
  const outputNames = findTitledNode(
    workflow,
    GPT_IMAGE_2_NODE_TITLES.outputNames,
    "PrimitiveStringMultiline"
  );
  const generate = findTitledNode(workflow, GPT_IMAGE_2_NODE_TITLES.generate, "HolopixGenerateV3");
  const crop = findTitledNode(workflow, GPT_IMAGE_2_NODE_TITLES.crop, "AutoObjectSheetCrop");
  const save = findTitledNode(workflow, GPT_IMAGE_2_NODE_TITLES.save, "SaveNamedImageBatch");
  const names = options.items.map((item) => safeOutputName(item.assetCode));
  const promptTemplate = stringInput(itemPrompt.node, "value", GPT_IMAGE_2_NODE_TITLES.itemPrompt);
  const promptText = buildGptImage2Prompt(options.items, promptTemplate);

  itemPrompt.node.inputs.value = promptText;
  outputNames.node.inputs.value = JSON.stringify(names);
  generate.node.inputs.aspect_ratio = gptImage2AspectRatio(options.items.length);
  generate.node.inputs.batch_size = "1";
  generate.node.inputs.request_nonce = options.requestNonce;
  generate.node.inputs.confirm_cost = options.confirmCost;
  crop.node.inputs.max_objects = options.items.length;
  save.node.inputs.subfolder = options.outputSubfolder;
  save.node.inputs.collision_policy = "overwrite";

  const timeoutInput = Number(generate.node.inputs.timeout_seconds);
  return {
    workflow,
    saveNodeId: save.id,
    timeoutSeconds: Number.isFinite(timeoutInput) ? Math.max(30, timeoutInput) : 150,
    promptText,
    outputNames: names
  };
}

export function assertGptImage2Workflow(value: unknown): asserts value is ComfyWorkflow {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("GptImage2.json 不是有效的 ComfyUI API 工作流对象。");
  }
  const workflow = value as ComfyWorkflow;
  const reference = findTitledNode(workflow, GPT_IMAGE_2_NODE_TITLES.reference, "LoadImage");
  const itemPrompt = findTitledNode(
    workflow,
    GPT_IMAGE_2_NODE_TITLES.itemPrompt,
    "PrimitiveStringMultiline"
  );
  const outputNames = findTitledNode(
    workflow,
    GPT_IMAGE_2_NODE_TITLES.outputNames,
    "PrimitiveStringMultiline"
  );
  const generate = findTitledNode(workflow, GPT_IMAGE_2_NODE_TITLES.generate, "HolopixGenerateV3");
  const crop = findTitledNode(workflow, GPT_IMAGE_2_NODE_TITLES.crop, "AutoObjectSheetCrop");
  const save = findTitledNode(workflow, GPT_IMAGE_2_NODE_TITLES.save, "SaveNamedImageBatch");

  const promptTemplate = stringInput(itemPrompt.node, "value", GPT_IMAGE_2_NODE_TITLES.itemPrompt);
  if (!promptTemplate.includes(GPT_IMAGE_2_ITEMS_MARKER)) {
    throw new Error(
      `GptImage2.json 节点“${GPT_IMAGE_2_NODE_TITLES.itemPrompt}”必须包含 ${GPT_IMAGE_2_ITEMS_MARKER} 占位符。`
    );
  }

  assertConnection(generate.node.inputs.prompt, itemPrompt.id, "GPT Image 2 整链生成必须连接整链提示词节点。");
  assertConnection(generate.node.inputs.images, reference.id, "GPT Image 2 整链生成必须连接风格参考图节点。");
  assertConnection(crop.node.inputs.image, generate.id, "GPT Image 2 裁切节点必须连接整链生成结果。");
  assertConnection(crop.node.inputs.labels, outputNames.id, "GPT Image 2 裁切节点必须连接输出名称节点。");
  if (!Array.isArray(save.node.inputs.images)) {
    throw new Error("GPT Image 2 保存节点没有连接透明抠图结果。");
  }
}

export function buildGptImage2Prompt(
  items: GptImage2WorkflowItem[],
  template = `参考输入图只用于学习统一画风。\n${GPT_IMAGE_2_ITEMS_MARKER}`
): string {
  const count = items.length;
  const columns = gptImage2GridColumns(count);
  const rows = Math.ceil(count / columns);
  const itemLines = items.map((item, index) => {
    const description = item.promptText?.trim() || item.itemName.trim() || item.assetCode;
    return `${index + 1}. ${description}`;
  });
  const itemBlock = [
    `在一张纯白背景画布上生成 ${count} 个互相独立的卡通游戏物件，固定排成 ${columns} 列 × ${rows} 行。`,
    "严格按下面清单从左到右、从上到下排列；不得遗漏、合并、重复或调换顺序。",
    "每格只放一个完整物件，四周留足空白。整体轮廓清楚，柔和渐变，色彩鲜艳明快，细节克制，左侧有轻微投影。",
    "除整体外轮廓外不要添加内部描边。不要写实，不要水彩质感，不要出现任何文字、编号、标签、水印或界面元素。",
    "物件清单：",
    ...itemLines
  ].join("\n");
  return template.includes(GPT_IMAGE_2_ITEMS_MARKER)
    ? template.replace(GPT_IMAGE_2_ITEMS_MARKER, itemBlock)
    : `${template.trim()}\n${itemBlock}`.trim();
}

export function gptImage2AspectRatio(itemCount: number): string {
  const columns = gptImage2GridColumns(Math.max(1, itemCount));
  const rows = Math.ceil(Math.max(1, itemCount) / columns);
  if (columns === rows) return "1:1";
  if (columns > rows) return "4:3";
  const portraitRatio = rows / columns;
  if (portraitRatio <= 1.34) return "4:5";
  if (portraitRatio <= 1.55) return "3:4";
  return "2:3";
}

export function safeGptImage2OutputName(value: string): string {
  return safeOutputName(value);
}

function findTitledNode(
  workflow: ComfyWorkflow,
  title: string,
  classType: string
): FoundNode {
  const matches = Object.entries(workflow).filter(([, node]) => (
    node?.class_type === classType && node._meta?.title === title
  ));
  if (matches.length !== 1) {
    throw new Error(
      `GptImage2.json 需要且只能包含 1 个标题为“${title}”的 ${classType} 节点，当前为 ${matches.length} 个。`
    );
  }
  const [id, node] = matches[0]!;
  if (!node.inputs || typeof node.inputs !== "object" || Array.isArray(node.inputs)) {
    throw new Error(`GptImage2.json 节点“${title}”缺少 inputs。`);
  }
  return { id, node };
}

function assertConnection(value: unknown, expectedNodeId: string, message: string): void {
  if (!Array.isArray(value) || String(value[0]) !== expectedNodeId) throw new Error(message);
}

function stringInput(node: ComfyWorkflowNode, inputName: string, title: string): string {
  const value = node.inputs[inputName];
  if (typeof value !== "string") {
    throw new Error(`GptImage2.json 节点“${title}”的 ${inputName} 必须是字符串。`);
  }
  return value;
}

function cloneWorkflow(workflow: ComfyWorkflow): ComfyWorkflow {
  return JSON.parse(JSON.stringify(workflow)) as ComfyWorkflow;
}

function safeOutputName(value: string): string {
  return value.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 80) || "unnamed";
}

function gptImage2GridColumns(itemCount: number): number {
  if (itemCount <= 1) return 1;
  if (itemCount <= 6) return 2;
  if (itemCount <= 12) return 3;
  if (itemCount <= 20) return 4;
  return Math.ceil(Math.sqrt(itemCount));
}
