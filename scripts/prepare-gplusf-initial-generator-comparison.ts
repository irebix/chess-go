import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import gPlusFWorkflow from "../GPlusF.json";
import holopixWorkflow from "../Holopix.json";
import {
  G_PLUS_F_NODE_TITLES,
  prepareGPlusFWorkflow,
  type GPlusFWorkflowItem
} from "../src/ai/gPlusFWorkflow";
import type {
  ComfyWorkflow,
  ComfyWorkflowNode
} from "../src/ai/holopixWorkflow";

type VariantKey = "v3" | "gpt-low" | "gpt-medium" | "gpt-high";
type GptQuality = "low" | "medium" | "high";

interface Variant {
  key: VariantKey;
  label: string;
  generatorClass: "HolopixGenerateV3" | "OpenAIGPTImage1";
  quality?: GptQuality;
}

interface FoundNode {
  id: string;
  node: ComfyWorkflowNode;
}

interface ManifestRun {
  variant: VariantKey;
  label: string;
  workflowPath: string;
  outputSubfolder: string;
  generatorNodeId: string;
  rawSaveNodeId: string;
  candidateSaveNodeId: string;
  generatorNonce: number;
  classCounts: Record<string, number>;
  generatorSettings: Record<string, unknown>;
}

const sourcePromptId = "3cd782a2-455e-45b4-a868-ebd88a759107";
const sourceV3Nonce = 781862746;
const sourceHistoryStyleImage = "ChessGo/GPlusF/style/781862746/blob";
const sourceStyleImage = "ImageRefinerStyle.png";
const timestamp = Date.now();
const outputDirectory = resolve(
  process.argv[2] ??
    "artifacts/gplusf-initial-generator-comparison-3cd782a2-2026-07-23"
);
const variants: Variant[] = [
  {
    key: "v3",
    label: "Holopix V3",
    generatorClass: "HolopixGenerateV3"
  },
  {
    key: "gpt-low",
    label: "GPT Image 2 low",
    generatorClass: "OpenAIGPTImage1",
    quality: "low"
  },
  {
    key: "gpt-medium",
    label: "GPT Image 2 medium",
    generatorClass: "OpenAIGPTImage1",
    quality: "medium"
  },
  {
    key: "gpt-high",
    label: "GPT Image 2 high",
    generatorClass: "OpenAIGPTImage1",
    quality: "high"
  }
];
const items: GPlusFWorkflowItem[] = [
  { assetCode: "c_autopart1", itemName: "螺丝帽", promptText: "螺丝帽" },
  { assetCode: "c_autopart2", itemName: "螺丝", promptText: "螺丝" },
  { assetCode: "c_autopart3", itemName: "螺丝刀", promptText: "螺丝刀" },
  { assetCode: "c_autopart4", itemName: "扳手", promptText: "扳手" },
  { assetCode: "c_autopart5", itemName: "钳子", promptText: "钳子" },
  { assetCode: "c_autopart6", itemName: "锤子", promptText: "锤子" },
  { assetCode: "c_autopart7", itemName: "锯子", promptText: "锯子" },
  { assetCode: "c_autopart8", itemName: "电钻", promptText: "电钻" },
  { assetCode: "c_autopart9", itemName: "角磨机", promptText: "角磨机" }
];

let baseNonce = timestamp % 1_800_000_000;
if (
  variants.some((_, index) => baseNonce + (index * 100) === sourceV3Nonce)
) {
  baseNonce += 1_000;
}
const runId = `${timestamp}-${baseNonce}`;
const outputRoot =
  `Holopix/ChessGo/GPlusF/initial-generator-comparison-3cd782a2/${runId}`;

mkdirSync(outputDirectory, { recursive: true });

const runs: ManifestRun[] = variants.map((variant, index) => {
  const generatorNonce = baseNonce + (index * 100);
  const outputSubfolder =
    `${outputRoot}/${variant.key}-${generatorNonce}`;
  const prepared = prepareGPlusFWorkflow(
    gPlusFWorkflow,
    {
      items,
      gptRequestNonce: generatorNonce,
      holopixRequestNonce: generatorNonce + 1,
      outputSubfolder
    },
    holopixWorkflow
  );
  const workflow = prepared.workflow as ComfyWorkflow;
  const reference = findTitledNode(
    workflow,
    G_PLUS_F_NODE_TITLES.reference,
    "LoadImage"
  );
  const crop = findTitledNode(
    workflow,
    G_PLUS_F_NODE_TITLES.crop,
    "AutoObjectSheetCrop"
  );
  const cropCountGuard = findTitledNode(
    workflow,
    G_PLUS_F_NODE_TITLES.cropCountGuard,
    "AssertImageBatchCount"
  );
  const removeBackground = findTitledNode(
    workflow,
    G_PLUS_F_NODE_TITLES.removeBackground,
    "BiRefNetRMBG"
  );

  reference.node.inputs.image = sourceStyleImage;
  removeBackground.node.inputs.image = [cropCountGuard.id, 0];

  if (variant.generatorClass === "HolopixGenerateV3") {
    const generator = workflow[prepared.gptGenerateNodeId]!;
    generator.inputs.request_nonce = generatorNonce;
    generator._meta = {
      title: "G+F｜初稿生成器比较｜Holopix V3"
    };
  } else {
    workflow[prepared.gptGenerateNodeId] = {
      class_type: "OpenAIGPTImage1",
      inputs: {
        prompt: ["2", 0],
        image: ["1", 0],
        model: "gpt-image-2",
        quality: variant.quality!,
        background: "opaque",
        size: "2048x2048",
        custom_width: 2048,
        custom_height: 2048,
        n: 1,
        // The installed node declares seed as not implemented by the backend.
        // A unique value still participates in ComfyUI's cache key.
        seed: generatorNonce
      },
      _meta: {
        title: `G+F｜初稿生成器比较｜${variant.label}`
      }
    };
  }

  pruneToOutputClosure(workflow, [
    prepared.rawSaveNodeId,
    prepared.saveNodeId
  ]);
  assertInitialGeneratorWorkflow(
    workflow,
    variant,
    prepared.gptGenerateNodeId,
    prepared.rawSaveNodeId,
    prepared.saveNodeId,
    crop.id,
    cropCountGuard.id,
    outputSubfolder,
    generatorNonce
  );

  const classCounts = countClasses(workflow);
  const workflowPath = resolve(
    outputDirectory,
    `gplusf-initial-generator-${variant.key}.json`
  );
  writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`, {
    encoding: "utf8"
  });

  const generator = workflow[prepared.gptGenerateNodeId]!;
  return {
    variant: variant.key,
    label: variant.label,
    workflowPath,
    outputSubfolder,
    generatorNodeId: prepared.gptGenerateNodeId,
    rawSaveNodeId: prepared.rawSaveNodeId,
    candidateSaveNodeId: prepared.saveNodeId,
    generatorNonce,
    classCounts,
    generatorSettings: {
      classType: generator.class_type,
      ...(variant.quality ? { quality: variant.quality } : {}),
      ...(generator.inputs.model ? { model: generator.inputs.model } : {}),
      ...(generator.inputs.size ? { size: generator.inputs.size } : {}),
      ...(generator.inputs.seed !== undefined
        ? { cacheBusterSeed: generator.inputs.seed }
        : {}),
      ...(generator.inputs.request_nonce !== undefined
        ? { requestNonce: generator.inputs.request_nonce }
        : {}),
      aspectRatio: generator.inputs.aspect_ratio ?? "1:1",
      referenceImage: sourceStyleImage
    }
  };
});

assertUnique(runs.map((run) => run.generatorNonce), "生成器 nonce/seed");
assertUnique(runs.map((run) => run.outputSubfolder), "输出目录");
if (new Set(runs.map((run) => (
  readPromptValue(run.workflowPath)
))).size !== 1) {
  throw new Error("四份初稿生成器比较工作流的整链提示词不一致。");
}

const manifestPath = resolve(outputDirectory, "manifest.json");
writeFileSync(
  manifestPath,
  `${JSON.stringify(
    {
      createdAt: new Date(timestamp).toISOString(),
      sourcePromptId,
      sourceV3Nonce,
      sourceHistoryStyleImage,
      sourceStyleImage,
      styleReferenceEquivalence:
        "ImageRefinerStyle.png is byte-identical to the historical extensionless blob; the canonical filename is used so the current LoadImage schema can validate it.",
      runId,
      itemCount: items.length,
      items,
      comparisonRule:
        "The style reference, nine-item prompt, crop validation, background removal, and named candidate saving are identical. Only the initial generator branch differs: Holopix V3 versus GPT Image 2 low/medium/high.",
      cacheIsolation:
        "Every generator branch has a unique request_nonce or inert cache-buster seed, and every branch writes to a distinct run-scoped output folder.",
      outputContract: {
        rawSheetsPerRun: 1,
        namedCandidatesPerRun: items.length,
        namedCandidates: items.map((item) => `${item.assetCode}.png`)
      },
      forbiddenNodes: {
        HolopixGenerate: 0,
        HolopixUploadReference: 0,
        HolopixModelStack: 0
      },
      paidSubmissionPerformed: false,
      automaticRetries: false,
      runs
    },
    null,
    2
  )}\n`,
  { encoding: "utf8" }
);

process.stdout.write(
  `${JSON.stringify({
    manifestPath,
    sourcePromptId,
    itemCount: items.length,
    paidSubmissionPerformed: false,
    runs: runs.map((run) => ({
      variant: run.variant,
      workflowPath: run.workflowPath,
      outputSubfolder: run.outputSubfolder,
      generatorNonce: run.generatorNonce,
      classCounts: run.classCounts,
      generatorSettings: run.generatorSettings
    }))
  })}\n`
);

function pruneToOutputClosure(
  workflow: ComfyWorkflow,
  outputNodeIds: string[]
): void {
  const reachable = new Set<string>();
  const pending = [...outputNodeIds];
  while (pending.length) {
    const nodeId = pending.pop()!;
    if (reachable.has(nodeId)) continue;
    const node = workflow[nodeId];
    if (!node) throw new Error(`工作流缺少输出依赖节点 ${nodeId}。`);
    reachable.add(nodeId);
    for (const value of Object.values(node.inputs)) {
      if (
        Array.isArray(value)
        && value.length === 2
        && workflow[String(value[0])]
        && Number.isInteger(Number(value[1]))
      ) {
        pending.push(String(value[0]));
      }
    }
  }
  for (const nodeId of Object.keys(workflow)) {
    if (!reachable.has(nodeId)) delete workflow[nodeId];
  }
}

function assertInitialGeneratorWorkflow(
  workflow: ComfyWorkflow,
  variant: Variant,
  generatorNodeId: string,
  rawSaveNodeId: string,
  candidateSaveNodeId: string,
  cropNodeId: string,
  cropCountGuardNodeId: string,
  outputSubfolder: string,
  generatorNonce: number
): void {
  const classCounts = countClasses(workflow);
  if (Object.keys(workflow).length !== 11) {
    throw new Error(`${variant.key} 初稿工作流节点数必须为 11。`);
  }
  if ((classCounts.HolopixGenerate ?? 0) !== 0) {
    throw new Error(`${variant.key} 不得包含逐件 HolopixGenerate。`);
  }
  for (const classType of [
    "HolopixUploadReference",
    "HolopixModelStack",
    "ImageFromBatch",
    "ImageBatch"
  ]) {
    if ((classCounts[classType] ?? 0) !== 0) {
      throw new Error(`${variant.key} 不得包含 ${classType}。`);
    }
  }
  const expectedV3 = variant.generatorClass === "HolopixGenerateV3" ? 1 : 0;
  const expectedGpt = variant.generatorClass === "OpenAIGPTImage1" ? 1 : 0;
  if (
    (classCounts.HolopixGenerateV3 ?? 0) !== expectedV3
    || (classCounts.OpenAIGPTImage1 ?? 0) !== expectedGpt
  ) {
    throw new Error(`${variant.key} 的初稿生成器类型或数量不正确。`);
  }

  const generator = workflow[generatorNodeId]!;
  const rawSave = workflow[rawSaveNodeId]!;
  const candidateSave = workflow[candidateSaveNodeId]!;
  const crop = workflow[cropNodeId]!;
  const cropCountGuard = workflow[cropCountGuardNodeId]!;
  const removeBackground = findTitledNode(
    workflow,
    G_PLUS_F_NODE_TITLES.removeBackground,
    "BiRefNetRMBG"
  );
  const joinAlpha = findTitledNode(
    workflow,
    G_PLUS_F_NODE_TITLES.joinAlpha,
    "JoinImageWithAlpha"
  );

  assertConnection(
    rawSave.inputs.images,
    generatorNodeId,
    0,
    `${variant.key} 原始九宫格必须直接来自初稿生成器。`
  );
  assertConnection(
    crop.inputs.image,
    generatorNodeId,
    0,
    `${variant.key} 裁切必须直接来自初稿生成器。`
  );
  assertConnection(
    cropCountGuard.inputs.image,
    cropNodeId,
    0,
    `${variant.key} 裁切数量校验必须读取裁切批次。`
  );
  assertConnection(
    cropCountGuard.inputs.crop_info,
    cropNodeId,
    2,
    `${variant.key} 裁切数量校验必须读取检测信息。`
  );
  assertConnection(
    removeBackground.node.inputs.image,
    cropCountGuardNodeId,
    0,
    `${variant.key} 必须在九件数量校验后才批量抠图。`
  );
  assertConnection(
    candidateSave.inputs.images,
    joinAlpha.id,
    0,
    `${variant.key} 候选保存必须连接透明抠图结果。`
  );
  assertConnection(
    candidateSave.inputs.names,
    cropNodeId,
    1,
    `${variant.key} 候选保存必须使用裁切输出名。`
  );
  if (
    Number(crop.inputs.max_objects) !== items.length
    || Number(cropCountGuard.inputs.expected_count) !== items.length
  ) {
    throw new Error(`${variant.key} 必须严格裁切并校验 ${items.length} 件物品。`);
  }
  if (
    candidateSave.inputs.subfolder !== outputSubfolder
    || rawSave.inputs.filename_prefix
      !== `${outputSubfolder}/checkpoints/gpt_raw`
  ) {
    throw new Error(`${variant.key} 的原图或候选输出目录不正确。`);
  }

  if (variant.generatorClass === "HolopixGenerateV3") {
    if (
      Number(generator.inputs.request_nonce) !== generatorNonce
      || String(generator.inputs.aspect_ratio) !== "1:1"
      || String(generator.inputs.batch_size) !== "1"
    ) {
      throw new Error("V3 分支的缓存隔离或 1:1 单图设置不正确。");
    }
    assertConnection(
      generator.inputs.images,
      "1",
      0,
      "V3 分支必须连接相同风格参考图。"
    );
  } else {
    if (
      generator.inputs.model !== "gpt-image-2"
      || generator.inputs.quality !== variant.quality
      || generator.inputs.size !== "2048x2048"
      || Number(generator.inputs.n) !== 1
      || Number(generator.inputs.seed) !== generatorNonce
    ) {
      throw new Error(`${variant.key} 的 GPT Image 2 设置不正确。`);
    }
    assertConnection(
      generator.inputs.image,
      "1",
      0,
      `${variant.key} 必须连接相同风格参考图。`
    );
  }
  assertConnection(
    generator.inputs.prompt,
    "2",
    0,
    `${variant.key} 必须连接相同整链提示词。`
  );
}

function findTitledNode(
  workflow: ComfyWorkflow,
  title: string,
  classType: string
): FoundNode {
  const matches = Object.entries(workflow).filter(([, node]) => (
    node.class_type === classType && node._meta?.title === title
  ));
  if (matches.length !== 1) {
    throw new Error(
      `初稿生成器比较工作流需要且只能包含 1 个“${title}” ${classType}，`
        + `当前为 ${matches.length} 个。`
    );
  }
  const [id, node] = matches[0]!;
  return { id, node };
}

function countClasses(workflow: ComfyWorkflow): Record<string, number> {
  return Object.values(workflow).reduce<Record<string, number>>(
    (counts, node) => {
      counts[node.class_type] = (counts[node.class_type] ?? 0) + 1;
      return counts;
    },
    {}
  );
}

function assertConnection(
  value: unknown,
  expectedNodeId: string,
  expectedOutput: number,
  message: string
): void {
  if (
    !Array.isArray(value)
    || String(value[0]) !== expectedNodeId
    || Number(value[1]) !== expectedOutput
  ) {
    throw new Error(message);
  }
}

function assertUnique(values: Array<string | number>, label: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`四份初稿生成器工作流的${label}必须互不重复。`);
  }
}

function readPromptValue(workflowPath: string): string {
  const workflow = JSON.parse(
    readFileSync(workflowPath, "utf8")
  ) as ComfyWorkflow;
  const prompt = findTitledNode(
    workflow,
    G_PLUS_F_NODE_TITLES.itemPrompt,
    "PrimitiveStringMultiline"
  );
  return String(prompt.node.inputs.value);
}
