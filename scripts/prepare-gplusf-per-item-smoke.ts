import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import gPlusFWorkflow from "../GPlusF.json";
import holopixWorkflow from "../Holopix.json";
import {
  prepareGPlusFWorkflow,
  type GPlusFWorkflowItem
} from "../src/ai/gPlusFWorkflow";

const outputPath = resolve(
  process.argv[2] ?? "artifacts/gplusf-per-item-smoke-0.8.2/workflow.json"
);
const timestamp = Date.now();
const gptRequestNonce = timestamp % 2_000_000_000;
const holopixRequestNonce = (gptRequestNonce + 1) % 2_000_000_000;
const items: GPlusFWorkflowItem[] = [
  {
    assetCode: "gpf_crop_smoke_01",
    itemName: "红色苹果",
    promptText: "一个完整的红色苹果，带一片绿色叶子"
  },
  {
    assetCode: "gpf_crop_smoke_02",
    itemName: "蓝色茶杯",
    promptText: "一个完整的蓝色陶瓷茶杯，杯口和把手清晰"
  }
];
const prepared = prepareGPlusFWorkflow(
  gPlusFWorkflow,
  {
    items,
    gptRequestNonce,
    holopixRequestNonce,
    outputSubfolder: `Holopix/ChessGo/GPlusF/per-item-smoke-0.8.2/${gptRequestNonce}`
  },
  holopixWorkflow
);

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(prepared.workflow, null, 2)}\n`, {
  encoding: "utf8"
});

process.stdout.write(`${JSON.stringify({
  outputPath,
  itemCount: items.length,
  estimatedCostPoints: 35 + (3 * items.length),
  gptGenerateNodeId: prepared.gptGenerateNodeId,
  cropSelectorNodeIds: prepared.cropSelectorNodeIds,
  uploadReferenceNodeIds: prepared.uploadReferenceNodeIds,
  holopixGenerateNodeIds: prepared.holopixGenerateNodeIds,
  finalRefinedBatchNodeId: prepared.finalRefinedBatchNodeId,
  saveNodeId: prepared.saveNodeId,
  timeoutSeconds: prepared.timeoutSeconds
})}\n`);
