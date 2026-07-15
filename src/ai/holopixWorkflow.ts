export interface ComfyWorkflowNode {
  inputs: Record<string, unknown>;
  class_type: string;
  _meta?: { title?: string };
}

export type ComfyWorkflow = Record<string, ComfyWorkflowNode>;

export interface PreparedHolopixWorkflow {
  workflow: ComfyWorkflow;
  generateNodeId: string;
  saveNodeId: string;
  timeoutSeconds: number;
  promptText: string;
}

export interface HolopixWorkflowOverrides {
  batchSize: 1 | 2 | 4;
  requestNonce: number;
  confirmCost: boolean;
  filenamePrefix: string;
  itemName: string;
  assetCode: string;
}

export interface HolopixPromptVariables {
  itemName: string;
  assetCode: string;
}

export interface HolopixPromptSource {
  kind: "text" | "node" | "unknown";
  label: string;
  detail: string;
}

export function prepareHolopixWorkflow(
  baseWorkflow: ComfyWorkflow,
  options: HolopixWorkflowOverrides
): PreparedHolopixWorkflow {
  const workflow = cloneWorkflow(baseWorkflow);
  const generate = findOnlyNode(workflow, "HolopixGenerate");
  const square = findOnlyNode(workflow, "ImageScale");
  const save = findOnlyNode(workflow, "SaveImage");
  const promptText = resolveHolopixPromptText(workflow, options);

  generate.node.inputs.aspect_ratio = "1:1";
  generate.node.inputs.batch_size = String(options.batchSize);
  generate.node.inputs.request_nonce = options.requestNonce;
  generate.node.inputs.confirm_cost = options.confirmCost;
  generate.node.inputs.prompt = promptText;
  delete generate.node.inputs.reference;
  square.node.inputs.image = [generate.id, 0];
  square.node.inputs.width = 1024;
  square.node.inputs.height = 1024;
  square.node.inputs.crop = "center";
  save.node.inputs.filename_prefix = options.filenamePrefix;
  save.node.inputs.images = [square.id, 0];

  const timeoutInput = Number(generate.node.inputs.timeout_seconds);
  const timeoutSeconds = Number.isFinite(timeoutInput)
    ? Math.min(240, Math.max(30, timeoutInput))
    : 150;

  return {
    workflow,
    generateNodeId: generate.id,
    saveNodeId: save.id,
    timeoutSeconds,
    promptText
  };
}

export function describeHolopixPromptSource(
  workflow: ComfyWorkflow,
  variables?: HolopixPromptVariables
): HolopixPromptSource {
  const generate = findOnlyNode(workflow, "HolopixGenerate");
  const prompt = generate.node.inputs.prompt;
  if (typeof prompt === "string" && prompt.trim()) {
    return {
      kind: "text",
      label: variables ? "HolopixGenerate.prompt · 当前节点" : "HolopixGenerate.prompt",
      detail: variables ? resolvePromptTemplate(prompt, variables) : prompt.trim()
    };
  }
  return {
    kind: "unknown",
    label: "HolopixGenerate.prompt",
    detail: "工作流必须在 HolopixGenerate.prompt 中直接配置文本提示词。"
  };
}

export function resolveHolopixPromptText(
  workflow: ComfyWorkflow,
  variables: HolopixPromptVariables
): string {
  const generate = findOnlyNode(workflow, "HolopixGenerate");
  const prompt = generate.node.inputs.prompt;
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new Error("HolopixGenerate.prompt 必须是非空文本；提示词-only 模式不接受参考图或提示词节点连线。");
  }
  return resolvePromptTemplate(prompt, variables);
}

export function splitHolopixBatches(candidateCount: number): Array<1 | 2 | 4> {
  if (!Number.isInteger(candidateCount) || candidateCount < 1 || candidateCount > 4) {
    throw new Error("Holopix 候选数只能是 1–4 的整数。");
  }
  if (candidateCount === 4) return [4];
  if (candidateCount === 3) return [2, 1];
  if (candidateCount === 2) return [2];
  return [1];
}

export function assertHolopixWorkflow(value: unknown): asserts value is ComfyWorkflow {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Holopix.json 不是有效的 ComfyUI API 工作流对象。");
  }
  const workflow = value as ComfyWorkflow;
  for (const classType of ["HolopixGenerate", "ImageScale", "SaveImage"]) {
    findOnlyNode(workflow, classType);
  }
  const forbidden = Object.entries(workflow).find(([, node]) =>
    ["LoadImage", "HolopixUploadReference", "HolopixImageToPrompt"].includes(node.class_type)
  );
  if (forbidden) {
    throw new Error(`Holopix.json 当前为提示词-only 模式，不能包含参考图节点 ${forbidden[1].class_type}（节点 ${forbidden[0]}）。`);
  }
  resolveHolopixPromptText(workflow, { itemName: "验证节点", assetCode: "validation" });
}

function resolvePromptTemplate(template: string, variables: HolopixPromptVariables): string {
  const assetCode = variables.assetCode.trim() || "未编号";
  const itemName = variables.itemName.trim() || assetCode;
  const resolved = template
    .split("{{name}}").join(itemName)
    .split("{{itemName}}").join(itemName)
    .split("{{assetCode}}").join(assetCode)
    .trim();
  if (!resolved) throw new Error("HolopixGenerate.prompt 解析后为空。");
  return resolved;
}

function cloneWorkflow(workflow: ComfyWorkflow): ComfyWorkflow {
  return JSON.parse(JSON.stringify(workflow)) as ComfyWorkflow;
}

function findOnlyNode(workflow: ComfyWorkflow, classType: string): { id: string; node: ComfyWorkflowNode } {
  const matches = Object.entries(workflow).filter(([, node]) => node?.class_type === classType);
  if (matches.length !== 1) {
    throw new Error(`Holopix.json 需要且只能包含 1 个 ${classType} 节点，当前为 ${matches.length} 个。`);
  }
  const match = matches[0]!;
  const node = match[1];
  if (!node.inputs || typeof node.inputs !== "object") {
    throw new Error(`${classType} 节点缺少 inputs。`);
  }
  return { id: match[0], node };
}
