import type { ComfyWorkflow, ComfyWorkflowNode } from "../ai/holopixWorkflow";
import { IMAGE_REFINER_BASE_PROMPT, IMAGE_REFINER_MAX_LAYERS } from "./types";

export const IMAGE_REFINER_REQUIRED_NODE_TYPES = [
  "LoadObjectImageFolder",
  "LoadImage",
  "ImageBatch",
  "DynamicObjectSheetPack",
  "PrimitiveStringMultiline",
  "HolopixGenerateV3",
  "Image Filter Adjustments",
  "DynamicObjectSheetUnpack",
  "BiRefNetRMBG",
  "InvertMask",
  "JoinImageWithAlpha",
  "SaveNamedImageBatch",
  "PreviewImage",
  "PreviewAny"
] as const;

export interface ImageRefinerWorkflowOptions {
  inputSubfolder: string;
  fileNames: string[];
  styleImagePath: string;
  promptSupplement: string;
  requestNonce: number;
  outputSubfolder: string;
}

export interface PreparedImageRefinerWorkflow {
  workflow: ComfyWorkflow;
  saveNodeId: string;
  generateNodeId: string;
  timeoutSeconds: number;
}

interface ImageRefinerNodes {
  load: NodeMatch;
  styleReference: NodeMatch;
  referenceBatch: NodeMatch;
  pack: NodeMatch;
  prompt: NodeMatch;
  generate: NodeMatch;
  adjustReturnedSheet: NodeMatch;
  unpack: NodeMatch;
  removeBackground: NodeMatch;
  invertMask: NodeMatch;
  joinAlpha: NodeMatch;
  save: NodeMatch;
}

interface NodeMatch {
  id: string;
  node: ComfyWorkflowNode;
}

export function assertImageRefinerWorkflow(value: unknown): asserts value is ComfyWorkflow {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ImageRefiner.json 不是有效的 ComfyUI API 工作流对象。");
  }
  resolveNodes(value as ComfyWorkflow);
}

export function prepareImageRefinerWorkflow(
  baseWorkflow: ComfyWorkflow,
  options: ImageRefinerWorkflowOptions
): PreparedImageRefinerWorkflow {
  assertImageRefinerWorkflow(baseWorkflow);
  const workflow = cloneWorkflow(baseWorkflow);
  const nodes = resolveNodes(workflow);
  const promptSupplement = options.promptSupplement.trim();
  const promptText = promptSupplement
    ? `${IMAGE_REFINER_BASE_PROMPT}\n${promptSupplement}`
    : IMAGE_REFINER_BASE_PROMPT;
  const inputSubfolder = safeSubfolder(options.inputSubfolder, "输入");
  const outputSubfolder = safeSubfolder(options.outputSubfolder, "输出");
  const styleImagePath = safeFileName(options.styleImagePath);
  if (!options.fileNames.length || options.fileNames.length > IMAGE_REFINER_MAX_LAYERS) {
    throw new Error(`AI细化每批需要 1–${IMAGE_REFINER_MAX_LAYERS} 个图层。`);
  }
  const fileNames = options.fileNames.map(safeFileName);

  nodes.load.node.inputs.input_subfolder = inputSubfolder;
  nodes.load.node.inputs.file_names = JSON.stringify(fileNames);
  nodes.load.node.inputs.recursive = false;
  nodes.load.node.inputs.max_images = fileNames.length;
  nodes.pack.node.inputs.max_images = fileNames.length;
  nodes.styleReference.node.inputs.image = styleImagePath;
  nodes.referenceBatch.node.inputs.image1 = [nodes.pack.id, 0];
  nodes.referenceBatch.node.inputs.image2 = [nodes.styleReference.id, 0];
  nodes.prompt.node.inputs.value = promptText;
  nodes.generate.node.inputs.images = [nodes.referenceBatch.id, 0];
  nodes.generate.node.inputs.prompt = [nodes.prompt.id, 0];
  nodes.generate.node.inputs.aspect_ratio = [nodes.pack.id, 2];
  nodes.generate.node.inputs.batch_size = "1";
  nodes.generate.node.inputs.request_nonce = options.requestNonce;
  nodes.generate.node.inputs.vip_channel = true;
  delete nodes.generate.node.inputs.confirm_cost;
  nodes.adjustReturnedSheet.node.inputs.image = [nodes.generate.id, 0];
  nodes.adjustReturnedSheet.node.inputs.brightness = 0.01;
  nodes.adjustReturnedSheet.node.inputs.contrast = 1;
  nodes.adjustReturnedSheet.node.inputs.saturation = 0.95;
  nodes.adjustReturnedSheet.node.inputs.sharpness = 1;
  nodes.adjustReturnedSheet.node.inputs.blur = 0;
  nodes.adjustReturnedSheet.node.inputs.gaussian_blur = 0;
  nodes.adjustReturnedSheet.node.inputs.edge_enhance = 0;
  nodes.adjustReturnedSheet.node.inputs.detail_enhance = "false";
  nodes.unpack.node.inputs.returned_sheet = [nodes.adjustReturnedSheet.id, 0];
  nodes.unpack.node.inputs.layout = [nodes.pack.id, 1];
  nodes.unpack.node.inputs.output_size = 512;
  nodes.removeBackground.node.inputs.image = [nodes.unpack.id, 0];
  nodes.invertMask.node.inputs.mask = [nodes.removeBackground.id, 1];
  nodes.joinAlpha.node.inputs.image = [nodes.removeBackground.id, 0];
  nodes.joinAlpha.node.inputs.alpha = [nodes.invertMask.id, 0];
  nodes.save.node.inputs.images = [nodes.joinAlpha.id, 0];
  nodes.save.node.inputs.names = [nodes.unpack.id, 1];
  nodes.save.node.inputs.subfolder = outputSubfolder;
  nodes.save.node.inputs.collision_policy = "overwrite";

  const timeoutInput = Number(nodes.generate.node.inputs.timeout_seconds);
  return {
    workflow,
    saveNodeId: nodes.save.id,
    generateNodeId: nodes.generate.id,
    timeoutSeconds: Number.isFinite(timeoutInput)
      ? Math.min(240, Math.max(30, timeoutInput))
      : 150
  };
}

function resolveNodes(workflow: ComfyWorkflow): ImageRefinerNodes {
  const load = findOnlyNode(workflow, "LoadObjectImageFolder");
  const styleReference = findOnlyNode(workflow, "LoadImage");
  const referenceBatch = findOnlyNode(workflow, "ImageBatch");
  const pack = findOnlyNode(workflow, "DynamicObjectSheetPack");
  const prompt = findOnlyNode(workflow, "PrimitiveStringMultiline");
  const generate = findOnlyNode(workflow, "HolopixGenerateV3");
  const adjustReturnedSheet = findOnlyNode(workflow, "Image Filter Adjustments");
  const unpack = findOnlyNode(workflow, "DynamicObjectSheetUnpack");
  const removeBackground = findOnlyNode(workflow, "BiRefNetRMBG");
  const invertMask = findOnlyNode(workflow, "InvertMask");
  const joinAlpha = findOnlyNode(workflow, "JoinImageWithAlpha");
  const save = findOnlyNode(workflow, "SaveNamedImageBatch");
  assertConnection(pack.node.inputs.images, load.id, 0, "DynamicObjectSheetPack.images");
  assertConnection(pack.node.inputs.names, load.id, 1, "DynamicObjectSheetPack.names");
  assertConnection(referenceBatch.node.inputs.image1, pack.id, 0, "ImageBatch.image1");
  assertConnection(referenceBatch.node.inputs.image2, styleReference.id, 0, "ImageBatch.image2");
  assertConnection(generate.node.inputs.images, referenceBatch.id, 0, "HolopixGenerateV3.images");
  assertConnection(generate.node.inputs.prompt, prompt.id, 0, "HolopixGenerateV3.prompt");
  assertConnection(
    adjustReturnedSheet.node.inputs.image,
    generate.id,
    0,
    "Image Filter Adjustments.image"
  );
  assertConnection(
    unpack.node.inputs.returned_sheet,
    adjustReturnedSheet.id,
    0,
    "DynamicObjectSheetUnpack.returned_sheet"
  );
  assertConnection(unpack.node.inputs.layout, pack.id, 1, "DynamicObjectSheetUnpack.layout");
  assertConnection(removeBackground.node.inputs.image, unpack.id, 0, "BiRefNetRMBG.image");
  assertConnection(invertMask.node.inputs.mask, removeBackground.id, 1, "InvertMask.mask");
  assertConnection(joinAlpha.node.inputs.image, removeBackground.id, 0, "JoinImageWithAlpha.image");
  assertConnection(joinAlpha.node.inputs.alpha, invertMask.id, 0, "JoinImageWithAlpha.alpha");
  assertConnection(save.node.inputs.images, joinAlpha.id, 0, "SaveNamedImageBatch.images");
  assertConnection(save.node.inputs.names, unpack.id, 1, "SaveNamedImageBatch.names");
  return {
    load,
    styleReference,
    referenceBatch,
    pack,
    prompt,
    generate,
    adjustReturnedSheet,
    unpack,
    removeBackground,
    invertMask,
    joinAlpha,
    save
  };
}

function findOnlyNode(workflow: ComfyWorkflow, classType: string): NodeMatch {
  const matches = Object.entries(workflow).filter(([, node]) => node?.class_type === classType);
  if (matches.length !== 1) {
    throw new Error(`ImageRefiner.json 需要且只能包含 1 个 ${classType} 节点，当前为 ${matches.length} 个。`);
  }
  const [id, node] = matches[0]!;
  if (!node.inputs || typeof node.inputs !== "object") {
    throw new Error(`ImageRefiner.json 的 ${classType} 节点缺少 inputs。`);
  }
  return { id, node };
}

function assertConnection(
  value: unknown,
  expectedNodeId: string,
  expectedOutput: number,
  label: string
): void {
  if (!Array.isArray(value) || value[0] !== expectedNodeId || value[1] !== expectedOutput) {
    throw new Error(`ImageRefiner.json 的 ${label} 连线无效。`);
  }
}

function safeSubfolder(value: string, label: string): string {
  const normalized = value.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!normalized || normalized.split("/").some((part) => !part || part === "." || part === "..")) {
    throw new Error(`AI细化${label}目录无效。`);
  }
  return normalized;
}

function safeFileName(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/");
  if (
    !normalized
    || normalized.startsWith("/")
    || normalized.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("AI细化上传文件名无效。");
  }
  return normalized;
}

function cloneWorkflow(workflow: ComfyWorkflow): ComfyWorkflow {
  return JSON.parse(JSON.stringify(workflow)) as ComfyWorkflow;
}
