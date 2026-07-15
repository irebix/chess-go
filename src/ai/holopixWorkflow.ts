import { HOLOPIX_PREVIEW_SIZE } from "./holopixPreview";

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
  previewNodeId: string;
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
  const save = findOnlyNode(workflow, "SaveImage");

  loadImage.node.inputs.image = options.imageName;
  uploadReference.node.inputs.image = [loadImage.id, 0];
  imageToPrompt.node.inputs.reference = [uploadReference.id, 0];
  generate.node.inputs.batch_size = String(options.batchSize);
  generate.node.inputs.request_nonce = options.requestNonce;
  generate.node.inputs.confirm_cost = options.confirmCost;
  generate.node.inputs.reference = [uploadReference.id, 0];
  save.node.inputs.filename_prefix = options.filenamePrefix;
  save.node.inputs.images = [generate.id, 0];

  const previewScaleNodeId = nextRuntimeNodeId(workflow);
  const previewNodeId = nextRuntimeNodeId(workflow, [previewScaleNodeId]);
  workflow[previewScaleNodeId] = {
    class_type: "ImageScale",
    inputs: {
      image: [generate.id, 0],
      upscale_method: "lanczos",
      width: HOLOPIX_PREVIEW_SIZE,
      height: HOLOPIX_PREVIEW_SIZE,
      crop: "center"
    },
    _meta: { title: "ChessGo safe thumbnail" }
  };
  workflow[previewNodeId] = {
    class_type: "PreviewImage",
    inputs: { images: [previewScaleNodeId, 0] },
    _meta: { title: "ChessGo safe preview output" }
  };

  const timeoutInput = Number(generate.node.inputs.timeout_seconds);
  const timeoutSeconds = Number.isFinite(timeoutInput)
    ? Math.min(240, Math.max(30, timeoutInput))
    : 150;

  return {
    workflow,
    generateNodeId: generate.id,
    saveNodeId: save.id,
    previewNodeId,
    timeoutSeconds
  };
}

export function describeHolopixPromptSource(workflow: ComfyWorkflow): HolopixPromptSource {
  const generate = findOnlyNode(workflow, "HolopixGenerate");
  const prompt = generate.node.inputs.prompt;
  if (typeof prompt === "string" && prompt.trim()) {
    return {
      kind: "text",
      label: "HolopixGenerate.prompt",
      detail: prompt.trim()
    };
  }
  if (Array.isArray(prompt) && typeof prompt[0] === "string") {
    const sourceId = prompt[0];
    const source = workflow[sourceId];
    if (source) {
      return {
        kind: "node",
        label: source._meta?.title?.trim() || source.class_type,
        detail: `${source.class_type} · 节点 ${sourceId}`
      };
    }
  }
  return {
    kind: "unknown",
    label: "HolopixGenerate.prompt",
    detail: "工作流中的提示词输入未配置。"
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
    "SaveImage"
  ]) {
    findOnlyNode(workflow, classType);
  }
}

function cloneWorkflow(workflow: ComfyWorkflow): ComfyWorkflow {
  return JSON.parse(JSON.stringify(workflow)) as ComfyWorkflow;
}

function nextRuntimeNodeId(workflow: ComfyWorkflow, reserved: string[] = []): string {
  const occupied = new Set([...Object.keys(workflow), ...reserved]);
  const numericIds = [...occupied]
    .map((id) => Number(id))
    .filter((id) => Number.isSafeInteger(id) && id >= 0);
  let next = numericIds.length ? Math.max(...numericIds) + 1 : 1;
  while (occupied.has(String(next))) next += 1;
  return String(next);
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
