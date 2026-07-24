import {
  buildGptImage2Prompt,
  GPT_IMAGE_2_ITEMS_MARKER,
  gptImage2AspectRatio,
  safeGptImage2OutputName,
  type GptImage2WorkflowItem
} from "./gptImage2Workflow";
import {
  assertHolopixWorkflow,
  type ComfyWorkflow,
  type ComfyWorkflowNode
} from "./holopixWorkflow";

export const G_PLUS_F_NODE_TITLES = {
  reference: "G+F｜风格参考图",
  itemPrompt: "G+F｜GPT Image 2 整链提示词",
  outputNames: "G+F｜输出名称",
  gptGenerate: "G+F｜GPT Image 2 初稿",
  crop: "G+F｜GPT 初稿按顺序裁切",
  cropCountGuard: "G+F｜裁切数量严格校验",
  removeBackground: "G+F｜批量抠图",
  invertMask: "G+F｜前景转 Alpha",
  joinAlpha: "G+F｜写入透明通道",
  save: "G+F｜保存逐图细化候选",
  rawSave: "G+F｜保存 GPT Raw Sheet",
  selectCrop: "G+F｜单图裁切",
  uploadReference: "G+F｜单图参考上传",
  refinementPrompt: "G+F｜单图细化提示词",
  modelPrimary: "G+F｜Holopix 模型 1",
  modelSecondary: "G+F｜Holopix 模型 2",
  holopixGenerate: "G+F｜Holopix 单图细化"
} as const;

export const G_PLUS_F_ITEMS_MARKER = GPT_IMAGE_2_ITEMS_MARKER;
export const G_PLUS_F_ITEM_MARKER = "{{CHESS_GO_ITEM}}";
export const G_PLUS_F_REFERENCE_WEIGHT = 0.4;

export const G_PLUS_F_HOLOPIX_MODEL_CHAIN = [
  { modelId: 858, strength: 0.6 },
  { modelId: 6768, strength: 0.8 }
] as const;

export const G_PLUS_F_HOLOPIX_FIXED_INPUTS = {
  aspect_ratio: "1:1",
  batch_size: "1",
  confirm_cost: true,
  timeout_seconds: 150,
  reference_weight: G_PLUS_F_REFERENCE_WEIGHT
} as const;

export type GPlusFWorkflowItem = GptImage2WorkflowItem;

export interface GPlusFWorkflowOverrides {
  items: GPlusFWorkflowItem[];
  gptRequestNonce: number;
  holopixRequestNonce: number;
  outputSubfolder: string;
}

export interface PreparedGPlusFWorkflow {
  workflow: ComfyWorkflow;
  saveNodeId: string;
  timeoutSeconds: number;
  promptText: string;
  outputNames: string[];
  refinementPromptText: string;
  refinementPromptTexts: string[];
  rawSaveNodeId: string;
  gptGenerateNodeId: string;
  holopixGenerateNodeId: string;
  holopixGenerateNodeIds: string[];
  uploadReferenceNodeIds: string[];
  cropSelectorNodeIds: string[];
  finalRefinedBatchNodeId: string;
}

interface FoundNode {
  id: string;
  node: ComfyWorkflowNode;
}

interface GPlusFNodes {
  reference: FoundNode;
  itemPrompt: FoundNode;
  outputNames: FoundNode;
  gptGenerate: FoundNode;
  crop: FoundNode;
  cropCountGuard: FoundNode;
  removeBackground: FoundNode;
  invertMask: FoundNode;
  joinAlpha: FoundNode;
  save: FoundNode;
  rawSave: FoundNode;
  selectCrop: FoundNode;
  uploadReference: FoundNode;
  refinementPrompt: FoundNode;
  modelPrimary: FoundNode;
  modelSecondary: FoundNode;
  holopixGenerate: FoundNode;
}

interface HolopixModelConfig {
  modelId: number;
  strength: number;
}

interface PerItemRefinementNodes {
  selectCrop: FoundNode;
  uploadReference: FoundNode;
  refinementPrompt: FoundNode;
  holopixGenerate: FoundNode;
  sequenceGate?: FoundNode;
  resultMerge?: FoundNode;
}

interface PerItemGraph {
  groups: PerItemRefinementNodes[];
  finalImageNodeId: string;
}

export function prepareGPlusFWorkflow(
  baseWorkflow: ComfyWorkflow,
  options: GPlusFWorkflowOverrides,
  holopixSourceWorkflow?: ComfyWorkflow
): PreparedGPlusFWorkflow {
  const baseNodes = inspectGPlusFTemplate(baseWorkflow, true);
  validateItems(options.items);
  validateNonce(options.gptRequestNonce, "GPT Image 2");
  validateNonce(options.holopixRequestNonce, "Holopix");
  const holopixNonces = gPlusFPerItemRequestNonces(
    options.holopixRequestNonce,
    options.items.length,
    options.gptRequestNonce
  );

  const outputSubfolder = normalizeOutputSubfolder(options.outputSubfolder);
  if (holopixSourceWorkflow) {
    assertHolopixWorkflow(holopixSourceWorkflow);
  } else {
    assertHolopixParity(baseWorkflow, baseNodes);
  }

  const workflow = cloneWorkflow(baseWorkflow);
  const nodes = inspectGPlusFTemplate(workflow, true);
  if (holopixSourceWorkflow) {
    synchronizeHolopixConfiguration(nodes, holopixSourceWorkflow);
    assertHolopixParity(workflow, nodes, holopixSourceWorkflow);
  }

  const outputNames = options.items.map((item) => safeGptImage2OutputName(item.assetCode));
  const promptTemplate = stringInput(
    nodes.itemPrompt.node,
    "value",
    G_PLUS_F_NODE_TITLES.itemPrompt
  );
  const refinementTemplate = stringInput(
    nodes.refinementPrompt.node,
    "value",
    G_PLUS_F_NODE_TITLES.refinementPrompt
  );
  const promptText = buildGptImage2Prompt(options.items, promptTemplate);
  const refinementPromptTexts = buildGPlusFRefinementPrompts(
    options.items,
    refinementTemplate
  );

  nodes.itemPrompt.node.inputs.value = promptText;
  nodes.outputNames.node.inputs.value = JSON.stringify(outputNames);
  nodes.gptGenerate.node.inputs.aspect_ratio = gPlusFAspectRatio(options.items.length);
  nodes.gptGenerate.node.inputs.batch_size = "1";
  nodes.gptGenerate.node.inputs.request_nonce = options.gptRequestNonce;
  nodes.gptGenerate.node.inputs.vip_channel = true;
  delete nodes.gptGenerate.node.inputs.confirm_cost;

  nodes.crop.node.inputs.max_objects = options.items.length;
  nodes.cropCountGuard.node.inputs.expected_count = options.items.length;
  nodes.save.node.inputs.subfolder = outputSubfolder;
  nodes.save.node.inputs.collision_policy = "overwrite";
  nodes.rawSave.node.inputs.filename_prefix = `${outputSubfolder}/checkpoints/gpt_raw`;

  const perItemGraph = buildPerItemRefinementGraph(
    workflow,
    nodes,
    refinementPromptTexts,
    holopixNonces
  );
  nodes.removeBackground.node.inputs.image = [perItemGraph.finalImageNodeId, 0];

  assertPreparedPerItemGraph(
    workflow,
    nodes,
    perItemGraph,
    refinementPromptTexts,
    holopixNonces
  );
  assertHolopixParity(workflow, nodes, holopixSourceWorkflow);

  const gptTimeout = normalizedTimeout(nodes.gptGenerate.node.inputs.timeout_seconds);
  const holopixTimeout = normalizedTimeout(
    nodes.holopixGenerate.node.inputs.timeout_seconds
  );
  const generateNodeIds = perItemGraph.groups.map((group) => group.holopixGenerate.id);
  return {
    workflow,
    saveNodeId: nodes.save.id,
    timeoutSeconds: gptTimeout + holopixTimeout * options.items.length,
    promptText,
    outputNames,
    refinementPromptText: refinementPromptTexts[0]!,
    refinementPromptTexts,
    rawSaveNodeId: nodes.rawSave.id,
    gptGenerateNodeId: nodes.gptGenerate.id,
    holopixGenerateNodeId: generateNodeIds[0]!,
    holopixGenerateNodeIds: generateNodeIds,
    uploadReferenceNodeIds: perItemGraph.groups.map((group) => group.uploadReference.id),
    cropSelectorNodeIds: perItemGraph.groups.map((group) => group.selectCrop.id),
    finalRefinedBatchNodeId: perItemGraph.finalImageNodeId
  };
}

export function assertGPlusFWorkflow(
  value: unknown,
  holopixSourceWorkflow?: ComfyWorkflow
): asserts value is ComfyWorkflow {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("GPlusF.json 不是有效的 ComfyUI API 工作流对象。");
  }
  if (holopixSourceWorkflow) assertHolopixWorkflow(holopixSourceWorkflow);
  const workflow = value as ComfyWorkflow;
  const nodes = inspectGPlusFTemplate(workflow, true);
  assertHolopixParity(workflow, nodes, holopixSourceWorkflow);
}

export function buildGPlusFRefinementPrompts(
  items: GPlusFWorkflowItem[],
  template = `以接入的单张 GPT 裁切图为唯一主体参考，只细化这一件物品。\n${G_PLUS_F_ITEM_MARKER}`
): string[] {
  validateItems(items);
  return items.map((item, index) => buildGPlusFItemRefinementPrompt(
    item,
    index,
    items.length,
    template
  ));
}

export function buildGPlusFItemRefinementPrompt(
  item: GPlusFWorkflowItem,
  index: number,
  total: number,
  template = `以接入的单张 GPT 裁切图为唯一主体参考，只细化这一件物品。\n${G_PLUS_F_ITEM_MARKER}`
): string {
  if (!Number.isInteger(index) || !Number.isInteger(total) || index < 0 || total < 1 || index >= total) {
    throw new Error("G+F 单图细化提示词的序号无效。");
  }
  const description = item.promptText?.trim() || item.itemName.trim() || item.assetCode;
  const itemBlock = `这是第 ${index + 1}/${total} 件单图；目标物品：${description}`;
  return template.includes(G_PLUS_F_ITEM_MARKER)
    ? template.replace(G_PLUS_F_ITEM_MARKER, itemBlock)
    : `${template.trim()}\n${itemBlock}`.trim();
}

export function gPlusFPerItemRequestNonces(
  firstHolopixNonce: number,
  itemCount: number,
  gptRequestNonce?: number
): number[] {
  validateNonce(firstHolopixNonce, "Holopix");
  if (!Number.isInteger(itemCount) || itemCount < 1 || itemCount > 64) {
    throw new Error("G+F 逐图 Holopix nonce 数量必须是 1–64。");
  }
  const nonceOffset = itemCount - 1;
  if (firstHolopixNonce > Number.MAX_SAFE_INTEGER - nonceOffset) {
    throw new Error("G+F 逐图 Holopix request_nonce 超出安全整数范围。");
  }
  const values = Array.from({ length: itemCount }, (_, index) => firstHolopixNonce + index);
  if (gptRequestNonce !== undefined) {
    validateNonce(gptRequestNonce, "GPT Image 2");
    if (values.includes(gptRequestNonce)) {
      throw new Error("G+F 的 GPT Image 2 nonce 不能与任何逐图 Holopix nonce 重复。");
    }
  }
  return values;
}

export function gPlusFAspectRatio(itemCount: number): string {
  const ratio = gptImage2AspectRatio(itemCount);
  return ratio === "4:5" ? "3:4" : ratio;
}

function inspectGPlusFTemplate(
  workflow: ComfyWorkflow,
  requireMarkers: boolean
): GPlusFNodes {
  const nodes: GPlusFNodes = {
    reference: findTitledNode(workflow, G_PLUS_F_NODE_TITLES.reference, "LoadImage"),
    itemPrompt: findTitledNode(
      workflow,
      G_PLUS_F_NODE_TITLES.itemPrompt,
      "PrimitiveStringMultiline"
    ),
    outputNames: findTitledNode(
      workflow,
      G_PLUS_F_NODE_TITLES.outputNames,
      "PrimitiveStringMultiline"
    ),
    gptGenerate: findTitledNode(
      workflow,
      G_PLUS_F_NODE_TITLES.gptGenerate,
      "HolopixGenerateV3"
    ),
    crop: findTitledNode(workflow, G_PLUS_F_NODE_TITLES.crop, "AutoObjectSheetCrop"),
    cropCountGuard: findTitledNode(
      workflow,
      G_PLUS_F_NODE_TITLES.cropCountGuard,
      "AssertImageBatchCount"
    ),
    removeBackground: findTitledNode(
      workflow,
      G_PLUS_F_NODE_TITLES.removeBackground,
      "BiRefNetRMBG"
    ),
    invertMask: findTitledNode(
      workflow,
      G_PLUS_F_NODE_TITLES.invertMask,
      "InvertMask"
    ),
    joinAlpha: findTitledNode(
      workflow,
      G_PLUS_F_NODE_TITLES.joinAlpha,
      "JoinImageWithAlpha"
    ),
    save: findTitledNode(workflow, G_PLUS_F_NODE_TITLES.save, "SaveNamedImageBatch"),
    rawSave: findTitledNode(workflow, G_PLUS_F_NODE_TITLES.rawSave, "SaveImage"),
    selectCrop: findTitledNode(
      workflow,
      G_PLUS_F_NODE_TITLES.selectCrop,
      "ImageFromBatch"
    ),
    uploadReference: findTitledNode(
      workflow,
      G_PLUS_F_NODE_TITLES.uploadReference,
      "HolopixUploadReference"
    ),
    refinementPrompt: findTitledNode(
      workflow,
      G_PLUS_F_NODE_TITLES.refinementPrompt,
      "PrimitiveStringMultiline"
    ),
    modelPrimary: findTitledNode(
      workflow,
      G_PLUS_F_NODE_TITLES.modelPrimary,
      "HolopixModelStack"
    ),
    modelSecondary: findTitledNode(
      workflow,
      G_PLUS_F_NODE_TITLES.modelSecondary,
      "HolopixModelStack"
    ),
    holopixGenerate: findTitledNode(
      workflow,
      G_PLUS_F_NODE_TITLES.holopixGenerate,
      "HolopixGenerate"
    )
  };

  if (requireMarkers) {
    assertMarker(
      nodes.itemPrompt,
      G_PLUS_F_NODE_TITLES.itemPrompt,
      G_PLUS_F_ITEMS_MARKER
    );
    assertMarker(
      nodes.refinementPrompt,
      G_PLUS_F_NODE_TITLES.refinementPrompt,
      G_PLUS_F_ITEM_MARKER
    );
  }

  assertConnection(
    nodes.gptGenerate.node.inputs.prompt,
    nodes.itemPrompt.id,
    0,
    "G+F 的 GPT Image 2 初稿必须连接整链提示词。"
  );
  assertConnection(
    nodes.gptGenerate.node.inputs.images,
    nodes.reference.id,
    0,
    "G+F 的 GPT Image 2 初稿必须连接风格参考图。"
  );
  assertConnection(
    nodes.rawSave.node.inputs.images,
    nodes.gptGenerate.id,
    0,
    "G+F 的 GPT Raw Sheet 检查点必须直接保存 GPT Image 2 初稿。"
  );
  assertConnection(
    nodes.crop.node.inputs.image,
    nodes.gptGenerate.id,
    0,
    "G+F 必须先裁切 GPT Image 2 整张初稿，不能先把整图交给 Holopix。"
  );
  assertConnection(
    nodes.crop.node.inputs.labels,
    nodes.outputNames.id,
    0,
    "G+F 的 GPT 初稿裁切节点必须连接输出名称。"
  );
  assertConnection(
    nodes.cropCountGuard.node.inputs.image,
    nodes.crop.id,
    0,
    "G+F 必须在任何付费 Holopix 分支前严格校验 GPT 裁切数量。"
  );
  assertConnection(
    nodes.cropCountGuard.node.inputs.crop_info,
    nodes.crop.id,
    2,
    "G+F 裁切数量校验必须同时读取截断前的检测数量。"
  );
  assertConnection(
    nodes.selectCrop.node.inputs.image,
    nodes.cropCountGuard.id,
    0,
    "G+F 的单图裁切模板必须从通过数量校验的 GPT 裁切批次取图。"
  );
  if (Number(nodes.selectCrop.node.inputs.batch_index) !== 0) {
    throw new Error("G+F 的单图裁切模板必须从 batch_index=0 开始。");
  }
  if (Number(nodes.selectCrop.node.inputs.length) !== 1) {
    throw new Error("G+F 的每个 ImageFromBatch 必须只提取 1 张图。");
  }
  assertConnection(
    nodes.uploadReference.node.inputs.image,
    nodes.selectCrop.id,
    0,
    "G+F 的 HolopixUploadReference.image 必须连接单张 GPT 裁切图。"
  );
  assertConnection(
    nodes.holopixGenerate.node.inputs.prompt,
    nodes.refinementPrompt.id,
    0,
    "G+F 的 Holopix 单图细化必须连接独立单图提示词。"
  );
  assertConnection(
    nodes.holopixGenerate.node.inputs.reference,
    nodes.uploadReference.id,
    0,
    "G+F 的 HolopixGenerate.reference 必须连接上传后的单张 GPT 裁切图。"
  );
  assertConnection(
    nodes.holopixGenerate.node.inputs.models,
    nodes.modelSecondary.id,
    0,
    "G+F 的 HolopixGenerate.models 必须连接第二个模型栈节点。"
  );
  assertConnection(
    nodes.modelSecondary.node.inputs.previous_models,
    nodes.modelPrimary.id,
    0,
    "G+F 的第二个 Holopix 模型必须接在第一个模型之后。"
  );
  if ("previous_models" in nodes.modelPrimary.node.inputs) {
    throw new Error("G+F 的第一个 Holopix 模型不能连接 previous_models。");
  }
  assertSingleImageGenerateInputs(nodes.holopixGenerate.node);
  assertPostProcessingConnections(nodes, nodes.holopixGenerate.id);
  return nodes;
}

function buildPerItemRefinementGraph(
  workflow: ComfyWorkflow,
  nodes: GPlusFNodes,
  refinementPromptTexts: string[],
  requestNonces: number[]
): PerItemGraph {
  const nextNodeId = createNodeIdAllocator(workflow);
  const groups: PerItemRefinementNodes[] = [];
  let previousGenerate: FoundNode | undefined;
  let accumulatedResult: FoundNode | undefined;

  for (let index = 0; index < refinementPromptTexts.length; index += 1) {
    const suffix = index === 0 ? "" : ` ${String(index + 1).padStart(2, "0")}`;
    let sequenceGate: FoundNode | undefined;
    let selectCrop: FoundNode;
    let uploadReference: FoundNode;
    let refinementPrompt: FoundNode;
    let holopixGenerate: FoundNode;

    if (index === 0) {
      selectCrop = nodes.selectCrop;
      uploadReference = nodes.uploadReference;
      refinementPrompt = nodes.refinementPrompt;
      holopixGenerate = nodes.holopixGenerate;
    } else {
      sequenceGate = addNode(workflow, nextNodeId(), {
        class_type: "ImageBatch",
        inputs: {
          image1: [nodes.cropCountGuard.id, 0],
          image2: [previousGenerate!.id, 0]
        },
        _meta: { title: `G+F｜逐图顺序门${suffix}` }
      });
      selectCrop = addNode(
        workflow,
        nextNodeId(),
        cloneNode(nodes.selectCrop.node, `${G_PLUS_F_NODE_TITLES.selectCrop}${suffix}`)
      );
      uploadReference = addNode(
        workflow,
        nextNodeId(),
        cloneNode(nodes.uploadReference.node, `${G_PLUS_F_NODE_TITLES.uploadReference}${suffix}`)
      );
      refinementPrompt = addNode(
        workflow,
        nextNodeId(),
        cloneNode(nodes.refinementPrompt.node, `${G_PLUS_F_NODE_TITLES.refinementPrompt}${suffix}`)
      );
      holopixGenerate = addNode(
        workflow,
        nextNodeId(),
        cloneNode(nodes.holopixGenerate.node, `${G_PLUS_F_NODE_TITLES.holopixGenerate}${suffix}`)
      );
    }

    selectCrop.node.inputs.image = [
      sequenceGate?.id ?? nodes.cropCountGuard.id,
      0
    ];
    selectCrop.node.inputs.batch_index = index;
    selectCrop.node.inputs.length = 1;
    uploadReference.node.inputs.image = [selectCrop.id, 0];
    refinementPrompt.node.inputs.value = refinementPromptTexts[index]!;
    holopixGenerate.node.inputs.prompt = [refinementPrompt.id, 0];
    holopixGenerate.node.inputs.models = [nodes.modelSecondary.id, 0];
    holopixGenerate.node.inputs.reference = [uploadReference.id, 0];
    holopixGenerate.node.inputs.aspect_ratio = "1:1";
    holopixGenerate.node.inputs.batch_size = "1";
    holopixGenerate.node.inputs.request_nonce = requestNonces[index]!;
    holopixGenerate.node.inputs.reference_weight = G_PLUS_F_REFERENCE_WEIGHT;

    let resultMerge: FoundNode | undefined;
    if (!accumulatedResult) {
      accumulatedResult = holopixGenerate;
    } else {
      resultMerge = addNode(workflow, nextNodeId(), {
        class_type: "ImageBatch",
        inputs: {
          image1: [accumulatedResult.id, 0],
          image2: [holopixGenerate.id, 0]
        },
        _meta: { title: `G+F｜逐图结果合批${suffix}` }
      });
      accumulatedResult = resultMerge;
    }
    previousGenerate = holopixGenerate;
    groups.push({
      selectCrop,
      uploadReference,
      refinementPrompt,
      holopixGenerate,
      ...(sequenceGate ? { sequenceGate } : {}),
      ...(resultMerge ? { resultMerge } : {})
    });
  }

  if (!accumulatedResult) throw new Error("G+F 未创建任何逐图 Holopix 节点。");
  return { groups, finalImageNodeId: accumulatedResult.id };
}

function assertPreparedPerItemGraph(
  workflow: ComfyWorkflow,
  nodes: GPlusFNodes,
  graph: PerItemGraph,
  refinementPromptTexts: string[],
  requestNonces: number[]
): void {
  if (graph.groups.length !== refinementPromptTexts.length) {
    throw new Error("G+F 逐图节点数量与细化提示词数量不一致。");
  }
  assertConnection(
    nodes.cropCountGuard.node.inputs.image,
    nodes.crop.id,
    0,
    "G+F 裁切数量校验必须连接 GPT 初稿裁切批次。"
  );
  assertConnection(
    nodes.cropCountGuard.node.inputs.crop_info,
    nodes.crop.id,
    2,
    "G+F 裁切数量校验必须读取 AutoObjectSheetCrop.INFO。"
  );
  if (Number(nodes.cropCountGuard.node.inputs.expected_count) !== graph.groups.length) {
    throw new Error("G+F 裁切数量校验必须等于本轮物品数。");
  }
  const allGenerates = Object.values(workflow).filter(
    (node) => node.class_type === "HolopixGenerate"
  );
  const allUploads = Object.values(workflow).filter(
    (node) => node.class_type === "HolopixUploadReference"
  );
  const allSelectors = Object.values(workflow).filter(
    (node) => node.class_type === "ImageFromBatch"
  );
  if (
    allGenerates.length !== graph.groups.length ||
    allUploads.length !== graph.groups.length ||
    allSelectors.length !== graph.groups.length
  ) {
    throw new Error("G+F 必须为每张 GPT 裁切图创建且只创建一组选择、上传和 Holopix 生成节点。");
  }

  const seenNonces = new Set<number>();
  let previousGenerate: FoundNode | undefined;
  let accumulatedResult: FoundNode | undefined;
  for (let index = 0; index < graph.groups.length; index += 1) {
    const group = graph.groups[index]!;
    if (index === 0) {
      if (group.sequenceGate) throw new Error("G+F 第一张单图不能包含顺序门。");
      assertConnection(
        group.selectCrop.node.inputs.image,
        nodes.cropCountGuard.id,
        0,
        "G+F 第一张单图必须来自通过数量校验的 GPT 裁切批次。"
      );
    } else {
      if (!group.sequenceGate || !previousGenerate) {
        throw new Error("G+F 后续单图缺少串联前一张生成任务的顺序门。");
      }
      assertConnection(
        group.sequenceGate.node.inputs.image1,
        nodes.cropCountGuard.id,
        0,
        "G+F 逐图顺序门的 image1 必须连接通过数量校验的 GPT 裁切批次。"
      );
      assertConnection(
        group.sequenceGate.node.inputs.image2,
        previousGenerate.id,
        0,
        "G+F 逐图顺序门必须等待上一张 Holopix 生成完成。"
      );
      assertConnection(
        group.selectCrop.node.inputs.image,
        group.sequenceGate.id,
        0,
        "G+F 后续 ImageFromBatch 必须连接逐图顺序门。"
      );
    }
    if (
      Number(group.selectCrop.node.inputs.batch_index) !== index ||
      Number(group.selectCrop.node.inputs.length) !== 1
    ) {
      throw new Error(`G+F 第 ${index + 1} 张必须按 batch_index=${index} 单独裁出。`);
    }
    assertConnection(
      group.uploadReference.node.inputs.image,
      group.selectCrop.id,
      0,
      "G+F 每个 HolopixUploadReference 必须只接收对应单张 GPT 裁切图。"
    );
    if (group.refinementPrompt.node.inputs.value !== refinementPromptTexts[index]) {
      throw new Error(`G+F 第 ${index + 1} 张的单图细化提示词没有正确注入。`);
    }
    assertConnection(
      group.holopixGenerate.node.inputs.prompt,
      group.refinementPrompt.id,
      0,
      "G+F 每个 HolopixGenerate 必须连接对应单图提示词。"
    );
    assertConnection(
      group.holopixGenerate.node.inputs.reference,
      group.uploadReference.id,
      0,
      "G+F 每个 HolopixGenerate.reference 必须连接对应单图上传结果。"
    );
    assertConnection(
      group.holopixGenerate.node.inputs.models,
      nodes.modelSecondary.id,
      0,
      "G+F 每个 HolopixGenerate 必须复用 Holopix.json 的两模型链。"
    );
    assertSingleImageGenerateInputs(group.holopixGenerate.node);
    const nonce = Number(group.holopixGenerate.node.inputs.request_nonce);
    if (nonce !== requestNonces[index] || seenNonces.has(nonce)) {
      throw new Error("G+F 每张单图必须使用独立且顺序稳定的 Holopix request_nonce。");
    }
    seenNonces.add(nonce);

    if (!accumulatedResult) {
      if (group.resultMerge) throw new Error("G+F 第一张单图不能包含结果合批节点。");
      accumulatedResult = group.holopixGenerate;
    } else {
      if (!group.resultMerge) throw new Error("G+F 后续单图缺少稳定顺序的结果合批节点。");
      assertConnection(
        group.resultMerge.node.inputs.image1,
        accumulatedResult.id,
        0,
        "G+F 逐图合批的 image1 必须保留之前的细化结果。"
      );
      assertConnection(
        group.resultMerge.node.inputs.image2,
        group.holopixGenerate.id,
        0,
        "G+F 逐图合批的 image2 必须追加当前细化结果。"
      );
      accumulatedResult = group.resultMerge;
    }
    previousGenerate = group.holopixGenerate;
  }

  if (!accumulatedResult || accumulatedResult.id !== graph.finalImageNodeId) {
    throw new Error("G+F 最终逐图合批节点不一致。");
  }
  assertPostProcessingConnections(nodes, graph.finalImageNodeId);
}

function assertPostProcessingConnections(
  nodes: GPlusFNodes,
  refinedImagesNodeId: string
): void {
  assertConnection(
    nodes.removeBackground.node.inputs.image,
    refinedImagesNodeId,
    0,
    "G+F 抠图节点必须连接按原顺序合并后的逐图 Holopix 结果。"
  );
  assertConnection(
    nodes.invertMask.node.inputs.mask,
    nodes.removeBackground.id,
    1,
    "G+F 前景 Alpha 必须来自 RMBG 的 mask 输出。"
  );
  assertConnection(
    nodes.joinAlpha.node.inputs.image,
    nodes.removeBackground.id,
    0,
    "G+F 透明通道节点必须连接 RMBG 图像输出。"
  );
  assertConnection(
    nodes.joinAlpha.node.inputs.alpha,
    nodes.invertMask.id,
    0,
    "G+F 透明通道节点必须连接反相后的前景 Alpha。"
  );
  assertConnection(
    nodes.save.node.inputs.names,
    nodes.crop.id,
    1,
    "G+F 最终保存节点必须使用 GPT 初稿裁切节点返回的名称。"
  );
  assertConnection(
    nodes.save.node.inputs.images,
    nodes.joinAlpha.id,
    0,
    "G+F 最终保存节点必须连接透明抠图结果。"
  );
}

function synchronizeHolopixConfiguration(
  targetNodes: GPlusFNodes,
  holopixSourceWorkflow: ComfyWorkflow
): void {
  const sourceGenerate = findOnlyClassNode(holopixSourceWorkflow, "HolopixGenerate");
  const sourceModels = readModelChain(holopixSourceWorkflow, sourceGenerate);
  if (sourceModels.length !== 2) {
    throw new Error(`Holopix.json 必须包含正好 2 个串联模型，当前为 ${sourceModels.length} 个。`);
  }
  applyModelConfig(targetNodes.modelPrimary, sourceModels[0]!);
  applyModelConfig(targetNodes.modelSecondary, sourceModels[1]!);
  delete targetNodes.modelPrimary.node.inputs.previous_models;
  targetNodes.modelSecondary.node.inputs.previous_models = [targetNodes.modelPrimary.id, 0];
  targetNodes.holopixGenerate.node.inputs.models = [targetNodes.modelSecondary.id, 0];
  for (const inputName of ["confirm_cost", "timeout_seconds"] as const) {
    targetNodes.holopixGenerate.node.inputs[inputName] = sourceGenerate.node.inputs[inputName];
  }
  targetNodes.holopixGenerate.node.inputs.aspect_ratio = "1:1";
  targetNodes.holopixGenerate.node.inputs.batch_size = "1";
  targetNodes.holopixGenerate.node.inputs.reference_weight = G_PLUS_F_REFERENCE_WEIGHT;
}

function assertHolopixParity(
  targetWorkflow: ComfyWorkflow,
  targetNodes: GPlusFNodes,
  holopixSourceWorkflow?: ComfyWorkflow
): void {
  const targetModels = readModelChain(targetWorkflow, targetNodes.holopixGenerate);
  let expectedModels: readonly HolopixModelConfig[] = G_PLUS_F_HOLOPIX_MODEL_CHAIN;
  let expectedConfirmCost: unknown = G_PLUS_F_HOLOPIX_FIXED_INPUTS.confirm_cost;
  let expectedTimeout: unknown = G_PLUS_F_HOLOPIX_FIXED_INPUTS.timeout_seconds;
  if (holopixSourceWorkflow) {
    const sourceGenerate = findOnlyClassNode(holopixSourceWorkflow, "HolopixGenerate");
    expectedModels = readModelChain(holopixSourceWorkflow, sourceGenerate);
    expectedConfirmCost = sourceGenerate.node.inputs.confirm_cost;
    expectedTimeout = sourceGenerate.node.inputs.timeout_seconds;
  }
  if (expectedModels.length !== 2) {
    throw new Error(`Holopix.json 必须包含正好 2 个串联模型，当前为 ${expectedModels.length} 个。`);
  }
  if (
    targetModels.length !== expectedModels.length ||
    targetModels.some((model, index) => (
      model.modelId !== expectedModels[index]!.modelId ||
      model.strength !== expectedModels[index]!.strength
    ))
  ) {
    throw new Error("GPlusF.json 的 Holopix 两模型链必须与 Holopix.json 完全一致。");
  }
  if (targetNodes.holopixGenerate.node.inputs.confirm_cost !== expectedConfirmCost) {
    throw new Error("GPlusF.json 的 HolopixGenerate.confirm_cost 必须与 Holopix.json 一致。");
  }
  if (targetNodes.holopixGenerate.node.inputs.timeout_seconds !== expectedTimeout) {
    throw new Error("GPlusF.json 的 HolopixGenerate.timeout_seconds 必须与 Holopix.json 一致。");
  }
  assertSingleImageGenerateInputs(targetNodes.holopixGenerate.node);
}

function readModelChain(
  workflow: ComfyWorkflow,
  generate: FoundNode
): HolopixModelConfig[] {
  const modelsConnection = generate.node.inputs.models;
  if (!Array.isArray(modelsConnection) || modelsConnection[1] !== 0) {
    throw new Error("HolopixGenerate.models 必须连接 HolopixModelStack。");
  }
  const reverseChain: HolopixModelConfig[] = [];
  const visited = new Set<string>();
  let currentId: string | undefined = String(modelsConnection[0]);
  while (currentId) {
    if (visited.has(currentId)) throw new Error("HolopixModelStack.previous_models 不能形成环。");
    visited.add(currentId);
    const node: ComfyWorkflowNode | undefined = workflow[currentId];
    if (!node || node.class_type !== "HolopixModelStack") {
      throw new Error("Holopix 模型链包含非 HolopixModelStack 节点。");
    }
    const modelId = Number(node.inputs.model_id);
    const strength = Number(node.inputs.strength);
    if (!Number.isInteger(modelId) || modelId < 1) {
      throw new Error("HolopixModelStack.model_id 必须是正整数。");
    }
    if (!Number.isFinite(strength) || strength < 0 || strength > 1) {
      throw new Error("HolopixModelStack.strength 必须是 0–1 的数字。");
    }
    reverseChain.push({ modelId, strength });
    const previous: unknown = node.inputs.previous_models;
    if (previous === undefined) {
      currentId = undefined;
    } else if (Array.isArray(previous) && previous[1] === 0) {
      currentId = String(previous[0]);
    } else {
      throw new Error("HolopixModelStack.previous_models 连接无效。");
    }
    if (reverseChain.length > 6) throw new Error("Holopix 模型链最多允许 6 个模型。");
  }
  return reverseChain.reverse();
}

function applyModelConfig(node: FoundNode, config: HolopixModelConfig): void {
  node.node.inputs.model_id = config.modelId;
  node.node.inputs.strength = config.strength;
}

function assertSingleImageGenerateInputs(generate: ComfyWorkflowNode): void {
  if (String(generate.inputs.aspect_ratio) !== "1:1") {
    throw new Error("G+F 的每个 HolopixGenerate.aspect_ratio 必须固定为 1:1。");
  }
  if (String(generate.inputs.batch_size) !== "1") {
    throw new Error("G+F 的每个 HolopixGenerate.batch_size 必须固定为 1。");
  }
  if (typeof generate.inputs.confirm_cost !== "boolean") {
    throw new Error("G+F 的 HolopixGenerate.confirm_cost 必须是布尔值。");
  }
  const timeout = Number(generate.inputs.timeout_seconds);
  if (!Number.isInteger(timeout) || timeout < 30 || timeout > 240) {
    throw new Error("G+F 的 HolopixGenerate.timeout_seconds 必须是 30–240 的整数。");
  }
  if (Number(generate.inputs.reference_weight) !== G_PLUS_F_REFERENCE_WEIGHT) {
    throw new Error(`G+F 的 Holopix 参考图权重必须固定为 ${G_PLUS_F_REFERENCE_WEIGHT}。`);
  }
}

function validateItems(items: GPlusFWorkflowItem[]): void {
  if (!items.length) throw new Error("G+F 整链至少需要 1 个物品。");
  if (items.length > 64) throw new Error("G+F 单次整链最多支持 64 个物品。");
}

function validateNonce(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`G+F 的 ${label} request_nonce 必须是非负安全整数。`);
  }
}

function normalizeOutputSubfolder(value: string): string {
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/|\/$/g, "");
  if (!normalized) throw new Error("G+F 缺少输出目录。");
  if (/^[A-Za-z]:/.test(normalized) || normalized.split("/").includes("..")) {
    throw new Error("G+F 输出目录必须是 ComfyUI output 下的相对子目录。");
  }
  return normalized;
}

function normalizedTimeout(value: unknown): number {
  const timeout = Number(value);
  return Number.isFinite(timeout) ? Math.min(240, Math.max(30, timeout)) : 150;
}

function assertMarker(found: FoundNode, title: string, marker: string): void {
  const value = stringInput(found.node, "value", title);
  if (!value.includes(marker)) {
    throw new Error(`GPlusF.json 节点“${title}”必须包含 ${marker} 占位符。`);
  }
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
      `GPlusF.json 需要且只能包含 1 个标题为“${title}”的 ${classType} 节点，当前为 ${matches.length} 个。`
    );
  }
  const [id, node] = matches[0]!;
  if (!node.inputs || typeof node.inputs !== "object" || Array.isArray(node.inputs)) {
    throw new Error(`GPlusF.json 节点“${title}”缺少 inputs。`);
  }
  return { id, node };
}

function findOnlyClassNode(workflow: ComfyWorkflow, classType: string): FoundNode {
  const matches = Object.entries(workflow).filter(([, node]) => node?.class_type === classType);
  if (matches.length !== 1) {
    throw new Error(`Holopix.json 需要且只能包含 1 个 ${classType} 节点，当前为 ${matches.length} 个。`);
  }
  const [id, node] = matches[0]!;
  return { id, node };
}

function assertConnection(
  value: unknown,
  expectedNodeId: string,
  expectedOutput: number,
  message: string
): void {
  if (
    !Array.isArray(value) ||
    String(value[0]) !== expectedNodeId ||
    value[1] !== expectedOutput
  ) {
    throw new Error(message);
  }
}

function stringInput(node: ComfyWorkflowNode, inputName: string, title: string): string {
  const value = node.inputs[inputName];
  if (typeof value !== "string") {
    throw new Error(`GPlusF.json 节点“${title}”的 ${inputName} 必须是字符串。`);
  }
  return value;
}

function createNodeIdAllocator(workflow: ComfyWorkflow): () => string {
  const numericIds = Object.keys(workflow)
    .map((id) => Number(id))
    .filter((id) => Number.isSafeInteger(id) && id >= 0);
  let nextId = (numericIds.length ? Math.max(...numericIds) : 0) + 1;
  return () => {
    while (workflow[String(nextId)]) nextId += 1;
    const allocated = String(nextId);
    nextId += 1;
    return allocated;
  };
}

function addNode(
  workflow: ComfyWorkflow,
  id: string,
  node: ComfyWorkflowNode
): FoundNode {
  if (workflow[id]) throw new Error(`G+F 动态节点 ID 冲突：${id}`);
  workflow[id] = node;
  return { id, node };
}

function cloneNode(node: ComfyWorkflowNode, title: string): ComfyWorkflowNode {
  const cloned = JSON.parse(JSON.stringify(node)) as ComfyWorkflowNode;
  cloned._meta = { ...(cloned._meta ?? {}), title };
  return cloned;
}

function cloneWorkflow(workflow: ComfyWorkflow): ComfyWorkflow {
  return JSON.parse(JSON.stringify(workflow)) as ComfyWorkflow;
}
