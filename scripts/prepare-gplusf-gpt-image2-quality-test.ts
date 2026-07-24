import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import gPlusFWorkflow from "../GPlusF.json";
import holopixWorkflow from "../Holopix.json";
import {
  prepareGPlusFWorkflow,
  type GPlusFWorkflowItem
} from "../src/ai/gPlusFWorkflow";
import type { ComfyWorkflow } from "../src/ai/holopixWorkflow";

type Quality = "low" | "high";

const outputDirectory = resolve(
  process.argv[2] ??
    "artifacts/gplusf-gpt-image2-quality-2026-07-23"
);
const timestamp = Date.now();
const baseNonce = timestamp % 1_900_000_000;
const qualities: Quality[] = ["low", "high"];
const items: GPlusFWorkflowItem[] = [
  {
    assetCode: "gpf_gpt2_quality_apple",
    itemName: "红色苹果",
    promptText: "一个完整的红色苹果，带一片清晰的绿色叶子"
  }
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
    referenceImageConnected: boolean;
  };
  holopixSettings: {
    tasks: number;
    referenceWeight: number;
    confirmCost: boolean;
  };
}

mkdirSync(outputDirectory, { recursive: true });

const manifest: ManifestEntry[] = qualities.map((quality, index) => {
  const gptRequestNonce = (baseNonce + index * 10) % 2_000_000_000;
  const holopixRequestNonce = (gptRequestNonce + 1) % 2_000_000_000;
  const outputSubfolder =
    `Holopix/ChessGo/GPlusF/gpt-image2-quality-test-2026-07-23/${quality}-${gptRequestNonce}`;
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
  workflow[prepared.gptGenerateNodeId] = {
    class_type: "OpenAIGPTImage1",
    inputs: {
      prompt: ["2", 0],
      image: ["1", 0],
      model: "gpt-image-2",
      quality,
      background: "opaque",
      size: "1024x1024",
      custom_width: 1024,
      custom_height: 1024,
      n: 1,
      seed: 424242
    },
    _meta: {
      title: `G+F｜GPT Image 2 初稿｜${quality}`
    }
  };

  const classCounts = Object.values(workflow).reduce<Record<string, number>>(
    (counts, node) => {
      counts[node.class_type] = (counts[node.class_type] ?? 0) + 1;
      return counts;
    },
    {}
  );
  if ((classCounts.HolopixGenerateV3 ?? 0) !== 0) {
    throw new Error(`${quality} 工作流仍包含 HolopixGenerateV3。`);
  }
  if ((classCounts.OpenAIGPTImage1 ?? 0) !== 1) {
    throw new Error(`${quality} 工作流的 GPT Image 2 节点数量不是 1。`);
  }
  if ((classCounts.HolopixGenerate ?? 0) !== 1) {
    throw new Error(`${quality} 工作流的 HolopixGenerate 节点数量不是 1。`);
  }
  if ((classCounts.HolopixUploadReference ?? 0) !== 1) {
    throw new Error(`${quality} 工作流的参考图上传节点数量不是 1。`);
  }

  const workflowPath = resolve(outputDirectory, `gplusf-gpt-image2-${quality}.json`);
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
      size: "1024x1024",
      n: 1,
      seed: 424242,
      referenceImageConnected: true
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
      itemCount: items.length,
      comparisonRule:
        "Only GPT quality differs semantically; request nonces and output folders differ to prevent cache reuse and file collisions.",
      expectedPaidRequests: {
        gptImage2: qualities.length,
        holopix: qualities.length,
        holopixPoints: qualities.length * 3
      },
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
