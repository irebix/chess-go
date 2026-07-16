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
  promptCaptureNodeId: string;
  timeoutSeconds: number;
}

export interface HolopixWorkflowOverrides {
  imageName?: string;
  itemName?: string;
  batchSize: 1 | 2 | 4;
  requestNonce: number;
  confirmCost: boolean;
  filenamePrefix: string;
  promptText?: string;
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
  const loadImage = findOnlyNode(workflow, "LoadImage");
  const itemName = findOnlyTitledNode(workflow, "物件名字输入", "PrimitiveStringMultiline");
  const promptFormat = findOnlyNode(workflow, "StringFormat");
  const qwenVl = findOnlyNode(workflow, "AILab_QwenVL");
  const generate = findOnlyNode(workflow, "HolopixGenerate");
  const square = findOnlyNode(workflow, "ImageScale");
  const save = findOnlyNode(workflow, "SaveImage");
  const promptCapture = findOnlyTitledNode(workflow, "提示词结果", "PreviewAny");

  const promptText = options.promptText?.trim();
  if (promptText) {
    generate.node.inputs.prompt = promptText;
    promptCapture.node.inputs.source = promptText;
    delete workflow[loadImage.id];
    delete workflow[itemName.id];
    delete workflow[promptFormat.id];
    delete workflow[qwenVl.id];
  } else {
    const imageName = options.imageName?.trim();
    if (!imageName) throw new Error("QwenVL 提示词工作流缺少已上传的参考图。");
    const resolvedItemName = options.itemName?.trim();
    if (!resolvedItemName) throw new Error("QwenVL 提示词工作流缺少物品名称。");
    loadImage.node.inputs.image = imageName;
    itemName.node.inputs.value = resolvedItemName;
    promptFormat.node.inputs["values.a"] = [itemName.id, 0];
    qwenVl.node.inputs.custom_prompt = [promptFormat.id, 0];
    qwenVl.node.inputs.image = [loadImage.id, 0];
    generate.node.inputs.prompt = [qwenVl.id, 0];
    promptCapture.node.inputs.source = [qwenVl.id, 0];
  }
  generate.node.inputs.aspect_ratio = "1:1";
  generate.node.inputs.batch_size = String(options.batchSize);
  generate.node.inputs.request_nonce = options.requestNonce;
  generate.node.inputs.confirm_cost = options.confirmCost;
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
    promptCaptureNodeId: promptCapture.id,
    timeoutSeconds
  };
}

export function describeHolopixPromptSource(workflow: ComfyWorkflow): HolopixPromptSource {
  const generate = findOnlyNode(workflow, "HolopixGenerate");
  const promptCapture = findOnlyTitledNode(workflow, "提示词结果", "PreviewAny");
  const prompt = generate.node.inputs.prompt;
  if (Array.isArray(prompt) && typeof prompt[0] === "string") {
    const sourceId = prompt[0];
    const source = workflow[sourceId];
    if (source?.class_type === "AILab_QwenVL") {
      return {
        kind: "node",
        label: promptCapture.node._meta?.title?.trim() || "提示词结果",
        detail: `等待生成或恢复后显示 QwenVL 返回的实际提示词（结果节点 ${promptCapture.id}）。`
      };
    }
  }
  return {
    kind: "unknown",
    label: "HolopixGenerate.prompt",
    detail: "工作流必须把 QwenVL 的文本输出连接到 HolopixGenerate.prompt。"
  };
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
  for (const classType of [
    "LoadImage",
    "PrimitiveStringMultiline",
    "StringFormat",
    "AILab_QwenVL",
    "HolopixGenerate",
    "ImageScale",
    "SaveImage",
    "PreviewAny"
  ]) {
    findOnlyNode(workflow, classType);
  }

  const loadImage = findOnlyNode(workflow, "LoadImage");
  const itemName = findOnlyTitledNode(workflow, "物件名字输入", "PrimitiveStringMultiline");
  const promptFormat = findOnlyNode(workflow, "StringFormat");
  const qwenVl = findOnlyNode(workflow, "AILab_QwenVL");
  const generate = findOnlyNode(workflow, "HolopixGenerate");
  const promptCapture = findOnlyTitledNode(workflow, "提示词结果", "PreviewAny");
  assertConnection(
    promptFormat.node.inputs["values.a"],
    itemName.id,
    "格式化文本 values.a 必须连接“物件名字输入”。"
  );
  assertConnection(
    qwenVl.node.inputs.custom_prompt,
    promptFormat.id,
    "QwenVL.custom_prompt 必须连接格式化文本。"
  );
  assertConnection(
    qwenVl.node.inputs.image,
    loadImage.id,
    "QwenVL.image 必须连接 LoadImage。"
  );
  assertConnection(
    generate.node.inputs.prompt,
    qwenVl.id,
    "HolopixGenerate.prompt 必须连接 QwenVL。"
  );
  assertConnection(
    promptCapture.node.inputs.source,
    qwenVl.id,
    "“提示词结果”必须连接 QwenVL。"
  );
  if ("reference" in generate.node.inputs) {
    throw new Error("HolopixGenerate 不能连接 reference；参考图只能用于前置 QwenVL 提示词节点。");
  }
}

function assertConnection(value: unknown, expectedNodeId: string, message: string): void {
  if (!Array.isArray(value) || value[0] !== expectedNodeId || value[1] !== 0) {
    throw new Error(message);
  }
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

function findOnlyTitledNode(
  workflow: ComfyWorkflow,
  title: string,
  classType: string
): { id: string; node: ComfyWorkflowNode } {
  const matches = Object.entries(workflow).filter(([, node]) => (
    node?.class_type === classType && node._meta?.title?.trim() === title
  ));
  if (matches.length !== 1) {
    throw new Error(`Holopix.json 需要且只能包含 1 个标题为“${title}”的 ${classType} 节点，当前为 ${matches.length} 个。`);
  }
  const match = matches[0]!;
  const node = match[1];
  if (!node.inputs || typeof node.inputs !== "object") {
    throw new Error(`${title} 节点缺少 inputs。`);
  }
  return { id: match[0], node };
}
