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
  imageName: string;
  batchSize: 1 | 2 | 4;
  requestNonce: number;
  confirmCost: boolean;
  filenamePrefix: string;
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
  const uploadReference = findOnlyNode(workflow, "HolopixUploadReference");
  const imageToPrompt = findOnlyNode(workflow, "HolopixImageToPrompt");
  const generate = findOnlyNode(workflow, "HolopixGenerate");
  const square = findOnlyNode(workflow, "ImageScale");
  const save = findOnlyNode(workflow, "SaveImage");
  const promptCapture = findOnlyNode(workflow, "easy showAnything");

  loadImage.node.inputs.image = options.imageName;
  uploadReference.node.inputs.image = [loadImage.id, 0];
  imageToPrompt.node.inputs.reference = [uploadReference.id, 0];
  generate.node.inputs.prompt = [imageToPrompt.id, 0];
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
  promptCapture.node.inputs.anything = [imageToPrompt.id, 0];

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
  const prompt = generate.node.inputs.prompt;
  if (Array.isArray(prompt) && typeof prompt[0] === "string") {
    const sourceId = prompt[0];
    const source = workflow[sourceId];
    if (source?.class_type === "HolopixImageToPrompt") {
      return {
        kind: "node",
        label: source._meta?.title?.trim() || "Holopix 图片转提示词",
        detail: `等待生成或恢复后显示该节点返回的实际提示词（节点 ${sourceId}）。`
      };
    }
  }
  return {
    kind: "unknown",
    label: "HolopixGenerate.prompt",
    detail: "工作流必须把 HolopixImageToPrompt 的文本输出连接到 HolopixGenerate.prompt。"
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
    "HolopixUploadReference",
    "HolopixImageToPrompt",
    "HolopixGenerate",
    "ImageScale",
    "SaveImage",
    "easy showAnything"
  ]) {
    findOnlyNode(workflow, classType);
  }

  const uploadReference = findOnlyNode(workflow, "HolopixUploadReference");
  const imageToPrompt = findOnlyNode(workflow, "HolopixImageToPrompt");
  const generate = findOnlyNode(workflow, "HolopixGenerate");
  const promptCapture = findOnlyNode(workflow, "easy showAnything");
  assertConnection(
    imageToPrompt.node.inputs.reference,
    uploadReference.id,
    "HolopixImageToPrompt.reference 必须连接 HolopixUploadReference。"
  );
  assertConnection(
    generate.node.inputs.prompt,
    imageToPrompt.id,
    "HolopixGenerate.prompt 必须连接 HolopixImageToPrompt。"
  );
  assertConnection(
    promptCapture.node.inputs.anything,
    imageToPrompt.id,
    "实际提示词记录节点必须连接 HolopixImageToPrompt。"
  );
  if ("reference" in generate.node.inputs) {
    throw new Error("HolopixGenerate 不能连接 reference；参考图只能用于前置图生文节点。");
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
