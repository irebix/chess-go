import { action, constants, core } from "photoshop";
import { storage } from "uxp";
import type { AssetCandidate, SheetGroup } from "../domain/models";
import {
  planTableGridVolumes,
  type TableGridVolumePlan
} from "../domain/tableGridPlan";
import {
  GRID_TABLE_SOURCE_SCHEMA,
  GRID_TABLE_SOURCE_VERSION,
  type GridTableSourceChain,
  type GridTableSourceMetadata
} from "../grid/GridTableSourceMetadata";
import { writeGridTableSourceMetadataStore } from "../grid/GridTableSourceMetadataStore";
import { gridSlotAt } from "../grid/GridGeometry";
import { GRID_BACKGROUND_LAYER_NAME } from "../grid/GridTemplate";
import {
  deleteTemporaryFile,
  listFolderFileNames,
  parentFolderForFile,
  selectPsdOutput,
  writeNamedTemporaryImage
} from "../infrastructure/filesystem/uxpFiles";
import type { ImportedWorkbook } from "../services/WorkbookService";
import {
  buildBatchOutputNamesFromFirstPsd,
  findOutputNameConflicts,
  sanitizeFileName
} from "../utils/fileNames";
import { normalizeGenerationError } from "../utils/generationErrors";
import { toErrorMessage, UserCancelledError } from "../utils/errors";
import {
  assertSingleBatchPlaySucceeded
} from "./aiCandidateBackfillSafety";
import { placeEmbeddedDescriptor } from "./actionDescriptors";
import {
  findLayerById,
  fitLayerInsideBounds,
  type LayerCollectionLike,
  type TransformableLayerLike
} from "./layerPlacementGeometry";
import {
  assertStandardGridNotCancelled,
  bundledGridBackground,
  createStandardGridDocumentFoundation,
  type StandardGridModalExecutionContext
} from "./StandardGridDocumentGenerator";

export interface TableGridGenerationProgress {
  stage: string;
  completed: number;
  total: number;
}

export interface TableGridGenerationOptions {
  workbook: ImportedWorkbook;
  sheetName: string;
  selectedGroups: SheetGroup[];
  items: AssetCandidate[];
  suggestedBaseName: string;
  onProgress?: (progress: TableGridGenerationProgress) => void;
}

export interface TableGridGenerationResult {
  documentId: number;
  psdFileName: string;
  volumeNumber: number;
  chainCount: number;
  itemCount: number;
}

interface TableGridLayerLike extends TransformableLayerLike {
  id: number;
  name: string;
  visible: boolean;
  move(relativeObject: unknown, placement: unknown): Promise<void> | void;
}

interface TableGridModalExecutionContext extends StandardGridModalExecutionContext {
  reportProgress?(options: { value: number; commandName?: string }): void;
}

interface GeneratedChainState {
  chain: TableGridVolumePlan["chains"][number];
  groupLayer: TableGridLayerLike;
  metadata: GridTableSourceChain;
}

export async function generateTableGridPsd(
  options: TableGridGenerationOptions
): Promise<TableGridGenerationResult[]> {
  const volumes = planTableGridVolumes(options.selectedGroups, options.items);
  const suggestedBaseName = sanitizeFileName(options.suggestedBaseName);
  const suggestedFirstPsdName = volumes.length === 1
    ? `${suggestedBaseName}.psd`
    : `${suggestedBaseName}_01.psd`;
  const firstPsdFile = await selectPsdOutput(suggestedFirstPsdName);
  const outputFolder = await parentFolderForFile(firstPsdFile);
  const outputNames = buildBatchOutputNamesFromFirstPsd(firstPsdFile.name, volumes.length);
  await assertSubsequentOutputNamesAvailable(
    outputFolder,
    outputNames.map((entry) => entry.psd)
  );

  const background = await bundledGridBackground();
  const backgroundToken = storage.localFileSystem.createSessionToken(background);
  const results: TableGridGenerationResult[] = [];
  const incompleteOutputFiles = new Set<storage.File>();
  const total = volumes.reduce((count, volume) => count + volume.itemCount, 0);
  let completed = 0;

  try {
    await core.executeAsModal(async (executionContext) => {
      const context = executionContext as unknown as TableGridModalExecutionContext;
      for (let volumeIndex = 0; volumeIndex < volumes.length; volumeIndex += 1) {
        assertStandardGridNotCancelled(context);
        const volume = volumes[volumeIndex]!;
        const outputName = outputNames[volumeIndex]!.psd;
        const outputFile = volumeIndex === 0
          ? firstPsdFile
          : await outputFolder.createFile(outputName);
        incompleteOutputFiles.add(outputFile);
        const document = await createStandardGridDocumentFoundation(
          outputFile,
          backgroundToken,
          context
        );
        const generatedChains = await createChainGroups(document, volume);
        await orderChainGroupsAboveBackground(document, generatedChains);

        for (const generated of generatedChains) {
          let previousImageLayerId: number | undefined;
          for (const plannedItem of generated.chain.items) {
            assertStandardGridNotCancelled(context);
            const item = plannedItem.item;
            const image = selectedImage(item);
            let imageLayerId: number | undefined;
            let temporaryImage: storage.File | null = null;
            try {
              if (image) {
                const bytes = await options.workbook.reader.archive.readBinary(
                  image.anchor.archiveEntry
                );
                temporaryImage = await writeNamedTemporaryImage(
                  bytes,
                  item.assetCode,
                  imageExtension(image.anchor.mediaType, image.anchor.archiveEntry)
                );
                assertStandardGridNotCancelled(context);
                const token = storage.localFileSystem.createSessionToken(temporaryImage);
                const placeResults = await action.batchPlay([placeEmbeddedDescriptor(token)], {});
                assertSingleBatchPlaySucceeded(placeResults, `置入 ${item.assetCode}`);
                const placedLayer = document.activeLayers[0] as unknown as TableGridLayerLike | undefined;
                if (!placedLayer) throw new Error(`图片置入后没有活动图层：${item.assetCode}`);
                placedLayer.name = item.assetCode;
                placedLayer.visible = true;
                await fitLayerInsideBounds(
                  placedLayer,
                  gridSlotAt(generated.chain.row, plannedItem.column).bounds,
                  { allowUpscale: false, tolerance: 1 }
                );
                if (previousImageLayerId !== undefined) {
                  const previousImageLayer = findLayerById(
                    document.layers as unknown as LayerCollectionLike,
                    previousImageLayerId
                  );
                  if (!previousImageLayer) {
                    throw new Error(`棋子链“${generated.chain.group.label}”的图层顺序已被意外改变。`);
                  }
                  await placedLayer.move(previousImageLayer, constants.ElementPlacement.PLACEAFTER);
                } else {
                  await placedLayer.move(
                    generated.groupLayer,
                    constants.ElementPlacement.PLACEINSIDE
                  );
                }
                previousImageLayerId = placedLayer.id;
                imageLayerId = placedLayer.id;
              }
              generated.metadata.items.push({
                assetCode: item.assetCode,
                ...(item.name?.trim() ? { name: item.name.trim() } : {}),
                sourceOrder: item.sourceOrder,
                column: plannedItem.column,
                ...(imageLayerId !== undefined ? { imageLayerId } : {})
              });
            } finally {
              if (temporaryImage) await deleteTemporaryFile(temporaryImage);
            }

            completed += 1;
            const stage = image
              ? `网格置入 ${item.assetCode}`
              : `网格保留空位 ${item.assetCode}`;
            context.reportProgress?.({ value: completed / total, commandName: stage });
            options.onProgress?.({ stage, completed, total });
            await Promise.resolve();
          }
        }

        const metadata: GridTableSourceMetadata = {
          schema: GRID_TABLE_SOURCE_SCHEMA,
          version: GRID_TABLE_SOURCE_VERSION,
          workbookName: options.workbook.sourceName,
          sheetName: options.sheetName,
          volumeNumber: volume.volumeNumber,
          volumeCount: volumes.length,
          chains: generatedChains.map((entry) => entry.metadata)
        };
        await writeGridTableSourceMetadataStore(document as never, metadata);
        assertStandardGridNotCancelled(context);
        await document.saveAs.psd(outputFile as never);
        incompleteOutputFiles.delete(outputFile);
        await context.hostControl.unregisterAutoCloseDocument(document.id);
        results.push({
          documentId: document.id,
          psdFileName: outputName,
          volumeNumber: volume.volumeNumber,
          chainCount: volume.chains.length,
          itemCount: volume.itemCount
        });
      }
    }, { commandName: "棋子go · 从表格生成网格 PSD" });
  } catch (error) {
    await cleanupIncompleteOutputs(incompleteOutputFiles);
    const normalized = normalizeGenerationError(error, completed, total);
    if (!(normalized instanceof UserCancelledError) && results.length) {
      throw new Error(
        `第 ${results.length + 1} 卷表格网格生成失败；前 ${results.length} 卷已完整保留。`
          + toErrorMessage(normalized)
      );
    }
    throw normalized;
  }

  return results;
}

async function createChainGroups(
  document: Awaited<ReturnType<typeof createStandardGridDocumentFoundation>>,
  volume: TableGridVolumePlan
): Promise<GeneratedChainState[]> {
  const generated: GeneratedChainState[] = [];
  for (const chain of volume.chains) {
    const groupLayer = await document.createLayerGroup({
      name: chain.group.label
    } as never) as unknown as TableGridLayerLike | null;
    if (!groupLayer) throw new Error(`Photoshop 未能创建棋子链图层组：${chain.group.label}`);
    groupLayer.name = chain.group.label;
    groupLayer.visible = true;
    generated.push({
      chain,
      groupLayer,
      metadata: {
        chainId: chain.group.id,
        label: chain.group.label,
        sourceCell: chain.group.sourceCell,
        row: chain.row,
        groupLayerId: groupLayer.id,
        items: []
      }
    });
  }
  return generated;
}

async function orderChainGroupsAboveBackground(
  document: Awaited<ReturnType<typeof createStandardGridDocumentFoundation>>,
  generatedChains: readonly GeneratedChainState[]
): Promise<void> {
  let anchor = document.layers.find(
    (layer) => layer.name === GRID_BACKGROUND_LAYER_NAME
  ) as unknown as TableGridLayerLike | undefined;
  if (!anchor) throw new Error("表格网格排序时找不到标准背景层。");
  for (let index = generatedChains.length - 1; index >= 0; index -= 1) {
    const group = generatedChains[index]!.groupLayer;
    await group.move(anchor, constants.ElementPlacement.PLACEBEFORE);
    anchor = group;
  }
}

async function assertSubsequentOutputNamesAvailable(
  folder: storage.Folder,
  plannedNames: string[]
): Promise<void> {
  const subsequentNames = plannedNames.slice(1);
  if (!subsequentNames.length) return;
  const conflicts = findOutputNameConflicts(
    subsequentNames,
    await listFolderFileNames(folder)
  );
  if (conflicts.length) {
    const preview = conflicts.slice(0, 4).join("、");
    const remaining = conflicts.length > 4 ? ` 等 ${conflicts.length} 个文件` : "";
    throw new Error(
      `输出目录中已存在后续分卷 ${preview}${remaining}。`
        + "请重新生成并在保存弹窗中使用其他名称。"
    );
  }
}

async function cleanupIncompleteOutputs(files: Set<storage.File>): Promise<void> {
  for (const file of files) {
    try {
      await file.delete();
    } catch (error) {
      if (/no such file|not found|不存在/i.test(toErrorMessage(error))) continue;
      console.warn("清理未完成表格网格 PSD 失败", file.name, error);
    }
  }
}

function selectedImage(item: AssetCandidate) {
  return item.imageCandidates.find((candidate) => candidate.id === item.selectedImageId);
}

function imageExtension(
  mediaType: "png" | "jpeg" | "other",
  archiveEntry: string
): string {
  if (mediaType === "jpeg") return "jpg";
  if (mediaType === "png") return "png";
  return /\.([a-z0-9]{2,5})$/i.exec(archiveEntry)?.[1]?.toLowerCase() ?? "bin";
}
