import type { ComfyWorkflow, ComfyWorkflowNode } from "../ai/holopixWorkflow";
import type { ImageEditorBatchSize, ImageEditorWorkflowVersion } from "./types";

const GENERATOR_TYPES: Record<ImageEditorWorkflowVersion, string> = {
  v2: "HolopixGenerateV2",
  v3: "HolopixGenerateV3"
};

export const IMAGE_EDITOR_REQUIRED_NODE_TYPES = [
  "LoadImage",
  "PrimitiveStringMultiline",
  "ResizeAndPadImage",
  "HolopixGenerateV2",
  "HolopixGenerateV3",
  "BiRefNetRMBG",
  "SaveImage"
] as const;

export interface PreparedImageEditorWorkflow {
  workflow: ComfyWorkflow;
  saveNodeId: string;
  generateNodeId: string;
  timeoutSeconds: number;
}

export interface ImageEditorWorkflowOptions {
  workflowVersion: ImageEditorWorkflowVersion;
  imageName: string;
  promptText: string;
  batchSize: ImageEditorBatchSize;
  requestNonce: number;
  filenamePrefix: string;
}

interface WorkflowBranch {
  load: NodeMatch;
  padding: NodeMatch;
  prompt: NodeMatch;
  generate: NodeMatch;
  removeBackground: NodeMatch;
  save: NodeMatch;
}

interface NodeMatch {
  id: string;
  node: ComfyWorkflowNode;
}

export function assertImageEditorWorkflow(value: unknown): asserts value is ComfyWorkflow {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ImageEditor.json 不是有效的 ComfyUI API 工作流对象。");
  }
  const workflow = value as ComfyWorkflow;
  const v2 = resolveBranch(workflow, "v2");
  const v3 = resolveBranch(workflow, "v3");
  assertWhiteSquarePadding(v2.padding.node);
  assertWhiteSquarePadding(v3.padding.node);
}

export function prepareImageEditorWorkflow(
  baseWorkflow: ComfyWorkflow,
  options: ImageEditorWorkflowOptions
): PreparedImageEditorWorkflow {
  assertImageEditorWorkflow(baseWorkflow);
  const cloned = cloneWorkflow(baseWorkflow);
  const branch = resolveBranch(cloned, options.workflowVersion);
  const promptText = options.promptText.trim();
  const imageName = options.imageName.trim();
  if (!promptText) throw new Error("AI编辑提示词不能为空。");
  if (!imageName) throw new Error("AI编辑工作流缺少已上传的选中图层。");

  branch.load.node.inputs.image = imageName;
  branch.prompt.node.inputs.value = promptText;
  branch.generate.node.inputs.prompt = [branch.prompt.id, 0];
  branch.generate.node.inputs.images = [branch.padding.id, 0];
  branch.generate.node.inputs.aspect_ratio = "1:1";
  branch.generate.node.inputs.batch_size = String(options.batchSize);
  branch.generate.node.inputs.request_nonce = options.requestNonce;
  branch.generate.node.inputs.vip_channel = true;
  delete branch.generate.node.inputs.confirm_cost;
  branch.padding.node.inputs.image = [branch.load.id, 0];
  branch.padding.node.inputs.target_width = 512;
  branch.padding.node.inputs.target_height = 512;
  branch.padding.node.inputs.padding_color = "white";
  branch.padding.node.inputs.interpolation = "lanczos";
  branch.removeBackground.node.inputs.image = [branch.generate.id, 0];
  branch.save.node.inputs.images = [branch.removeBackground.id, 0];
  branch.save.node.inputs.filename_prefix = options.filenamePrefix;

  const retained = new Set(Object.values(branch).map((match) => match.id));
  const workflow = Object.fromEntries(
    Object.entries(cloned).filter(([id]) => retained.has(id))
  );
  const timeoutInput = Number(branch.generate.node.inputs.timeout_seconds);
  return {
    workflow,
    saveNodeId: branch.save.id,
    generateNodeId: branch.generate.id,
    timeoutSeconds: Number.isFinite(timeoutInput)
      ? Math.min(240, Math.max(30, timeoutInput))
      : 200
  };
}

function resolveBranch(
  workflow: ComfyWorkflow,
  version: ImageEditorWorkflowVersion
): WorkflowBranch {
  const generate = findOnlyNode(workflow, GENERATOR_TYPES[version]);
  const prompt = connectedNode(
    workflow,
    generate.node.inputs.prompt,
    "PrimitiveStringMultiline",
    `${GENERATOR_TYPES[version]}.prompt`
  );
  const padding = connectedNode(
    workflow,
    generate.node.inputs.images,
    "ResizeAndPadImage",
    `${GENERATOR_TYPES[version]}.images`
  );
  const load = connectedNode(
    workflow,
    padding.node.inputs.image,
    "LoadImage",
    "ResizeAndPadImage.image"
  );
  const removeBackground = downstreamNode(
    workflow,
    generate.id,
    "BiRefNetRMBG",
    "image"
  );
  const save = downstreamNode(workflow, removeBackground.id, "SaveImage", "images");
  return { load, padding, prompt, generate, removeBackground, save };
}

function assertWhiteSquarePadding(node: ComfyWorkflowNode): void {
  const width = Number(node.inputs.target_width);
  const height = Number(node.inputs.target_height);
  if (!Number.isInteger(width) || width !== height || width <= 300) {
    throw new Error("ImageEditor.json 的白底预处理必须输出边长大于 300 px 的 1:1 图像。");
  }
  if (String(node.inputs.padding_color).toLowerCase() !== "white") {
    throw new Error("ImageEditor.json 的 1:1 扩边底色必须为白色。");
  }
}

function findOnlyNode(workflow: ComfyWorkflow, classType: string): NodeMatch {
  const matches = Object.entries(workflow).filter(([, node]) => node?.class_type === classType);
  if (matches.length !== 1) {
    throw new Error(`ImageEditor.json 需要且只能包含 1 个 ${classType} 节点，当前为 ${matches.length} 个。`);
  }
  const [id, node] = matches[0]!;
  if (!node.inputs || typeof node.inputs !== "object") {
    throw new Error(`${classType} 节点缺少 inputs。`);
  }
  return { id, node };
}

function connectedNode(
  workflow: ComfyWorkflow,
  connection: unknown,
  classType: string,
  label: string
): NodeMatch {
  if (!Array.isArray(connection) || typeof connection[0] !== "string") {
    throw new Error(`ImageEditor.json 的 ${label} 没有连接节点。`);
  }
  const node = workflow[connection[0]];
  if (!node || node.class_type !== classType) {
    throw new Error(`ImageEditor.json 的 ${label} 必须连接 ${classType}。`);
  }
  return { id: connection[0], node };
}

function downstreamNode(
  workflow: ComfyWorkflow,
  sourceNodeId: string,
  classType: string,
  inputName: string
): NodeMatch {
  const matches = Object.entries(workflow).filter(([, node]) => {
    if (node.class_type !== classType) return false;
    const connection = node.inputs?.[inputName];
    return Array.isArray(connection) && connection[0] === sourceNodeId;
  });
  if (matches.length !== 1) {
    throw new Error(`ImageEditor.json 需要 1 个从节点 ${sourceNodeId} 连接的 ${classType}，当前为 ${matches.length} 个。`);
  }
  const [id, node] = matches[0]!;
  return { id, node };
}

function cloneWorkflow(workflow: ComfyWorkflow): ComfyWorkflow {
  return JSON.parse(JSON.stringify(workflow)) as ComfyWorkflow;
}
