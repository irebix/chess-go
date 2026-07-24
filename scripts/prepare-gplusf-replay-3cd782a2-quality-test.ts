import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import gPlusFWorkflow from "../GPlusF.json";
import holopixWorkflow from "../Holopix.json";
import {
  prepareGPlusFWorkflow,
  type GPlusFWorkflowItem
} from "../src/ai/gPlusFWorkflow";
import type { ComfyWorkflow } from "../src/ai/holopixWorkflow";

type Quality = "low" | "medium" | "high";

const sourcePromptId = "3cd782a2-455e-45b4-a868-ebd88a759107";
const sourceStyleImage = "ChessGo/GPlusF/style/781862746/blob";
const loadableStyleImage = "ImageRefinerStyle.png";
const outputDirectory = resolve(
  process.argv[2] ??
    "artifacts/gplusf-replay-3cd782a2-quality-2026-07-23"
);
const timestamp = Date.now();
const baseNonce = timestamp % 1_800_000_000;
const qualities: Quality[] = ["low", "medium", "high"];
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

interface ManifestEntry {
  quality: Quality;
  workflowPath: string;
  outputSubfolder: string;
  gptNodeId: string;
  rawSaveNodeId: string;
  finalSaveNodeId: string;
  classCounts: Record<string, number>;
  gptSettings: {
    model: string;
    quality: Quality;
    background: string;
    size: string;
    n: number;
    seed: number;
    referenceImage: string;
  };
  holopixSettings: {
    tasks: number;
    referenceWeight: number;
    confirmCost: boolean;
  };
}

mkdirSync(outputDirectory, { recursive: true });

const manifest: ManifestEntry[] = qualities.map((quality, index) => {
  const gptRequestNonce = (baseNonce + index * 100) % 2_000_000_000;
  const holopixRequestNonce = (gptRequestNonce + 1) % 2_000_000_000;
  const outputSubfolder =
    `Holopix/ChessGo/GPlusF/replay-3cd782a2/${quality}-${gptRequestNonce}`;
  const prepared = prepareGPlusFWorkflow(
    gPlusFWorkflow,
    {
      items,
      gptRequestNonce,
      holopixRequestNonce,
      outputSubfolder
    },
    holopixWorkflow
  );

  const workflow = prepared.workflow as ComfyWorkflow;
  // The original history entry points to an extensionless file. ComfyUI's
  // current LoadImage enum rejects that name, so use its byte-identical,
  // SHA-256-verified PNG alias for execution.
  workflow["1"]!.inputs.image = loadableStyleImage;
  workflow[prepared.gptGenerateNodeId] = {
    class_type: "OpenAIGPTImage1",
    inputs: {
      prompt: ["2", 0],
      image: ["1", 0],
      model: "gpt-image-2",
      quality,
      background: "opaque",
      size: "2048x2048",
      custom_width: 2048,
      custom_height: 2048,
      n: 1,
      seed: 782455107
    },
    _meta: {
      title: `G+F｜GPT Image 2 初稿｜${quality}｜重跑 3cd782a2`
    }
  };

  const classCounts = Object.values(workflow).reduce<Record<string, number>>(
    (counts, node) => {
      counts[node.class_type] = (counts[node.class_type] ?? 0) + 1;
      return counts;
    },
    {}
  );
  const expectedPerItemCount = items.length;
  if ((classCounts.HolopixGenerateV3 ?? 0) !== 0) {
    throw new Error(`${quality} 工作流仍包含 HolopixGenerateV3。`);
  }
  if ((classCounts.OpenAIGPTImage1 ?? 0) !== 1) {
    throw new Error(`${quality} 工作流的 GPT Image 2 节点数量不是 1。`);
  }
  if ((classCounts.HolopixGenerate ?? 0) !== expectedPerItemCount) {
    throw new Error(`${quality} 工作流的 HolopixGenerate 节点数量不是 ${expectedPerItemCount}。`);
  }
  if ((classCounts.HolopixUploadReference ?? 0) !== expectedPerItemCount) {
    throw new Error(
      `${quality} 工作流的参考图上传节点数量不是 ${expectedPerItemCount}。`
    );
  }

  const workflowPath = resolve(
    outputDirectory,
    `gplusf-replay-3cd782a2-${quality}.json`
  );
  writeFileSync(workflowPath, `${JSON.stringify(workflow, null, 2)}\n`, {
    encoding: "utf8"
  });

  const holopixNode = workflow[prepared.holopixGenerateNodeId]!;
  return {
    quality,
    workflowPath,
    outputSubfolder,
    gptNodeId: prepared.gptGenerateNodeId,
    rawSaveNodeId: prepared.rawSaveNodeId,
    finalSaveNodeId: prepared.saveNodeId,
    classCounts,
    gptSettings: {
      model: "gpt-image-2",
      quality,
      background: "opaque",
      size: "2048x2048",
      n: 1,
      seed: 782455107,
      referenceImage: loadableStyleImage
    },
    holopixSettings: {
      tasks: prepared.holopixGenerateNodeIds.length,
      referenceWeight: Number(holopixNode.inputs.reference_weight),
      confirmCost: Boolean(holopixNode.inputs.confirm_cost)
    }
  };
});

const manifestPath = resolve(outputDirectory, "manifest.json");
writeFileSync(
  manifestPath,
  `${JSON.stringify(
    {
      createdAt: new Date(timestamp).toISOString(),
      sourcePromptId,
      sourceStyleImage,
      loadableStyleImage,
      sourceStyleImageSha256:
        "845CFB2161FDDBD04501D99519EB8E5668BFF8321F2F94BA5A052B1EB2D0EA6D",
      itemCount: items.length,
      items,
      comparisonRule:
        "GPT quality is the only semantic variant. Request nonces and output folders differ to prevent cache reuse and file collisions.",
      expectedPaidRequests: {
        gptImage2: qualities.length,
        holopix: qualities.length * items.length,
        holopixPoints: qualities.length * items.length * 3
      },
      executionMode: "strictly sequential",
      automaticRetries: false,
      runs: manifest
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
    sourceStyleImage,
    loadableStyleImage,
    itemCount: items.length,
    expectedPaidRequests: {
      gptImage2: qualities.length,
      holopix: qualities.length * items.length,
      holopixPoints: qualities.length * items.length * 3
    },
    runs: manifest.map((entry) => ({
      quality: entry.quality,
      workflowPath: entry.workflowPath,
      outputSubfolder: entry.outputSubfolder,
      classCounts: entry.classCounts,
      gptSettings: entry.gptSettings,
      holopixSettings: entry.holopixSettings
    }))
  })}\n`
);
