import { action, app, constants, core } from "photoshop";
import { storage } from "uxp";
import type { AssetCandidate, PsdTemplate, SheetGroup } from "../domain/models";
import {
  MAX_EDITABLE_CANVAS_SIZE,
  MIN_EDITABLE_CANVAS_SIZE,
  isValidEditableCanvasSize
} from "../domain/generationSettings";
import { calculateContainTransform } from "../domain/contain";
import { layoutItems, splitIntoVolumes } from "../domain/layout";
import type { ImportedWorkbook } from "../services/WorkbookService";
import {
  parentFolderForFile,
  selectPsdOutput,
  writeTemporaryImage,
  deleteTemporaryFile,
  listFolderFileNames
} from "../infrastructure/filesystem/uxpFiles";
import {
  buildBatchOutputNamesFromFirstPsd,
  findOutputNameConflicts,
  sanitizeFileName
} from "../utils/fileNames";
import { normalizeGenerationError } from "../utils/generationErrors";
import { toErrorMessage, UserCancelledError } from "../utils/errors";
import { makeArtboardDescriptor, placeEmbeddedDescriptor } from "./actionDescriptors";
import { smartObjectBoundsFromDescriptor } from "./smartObjectBounds";
import {
  editableCanvasLayerName,
  REFERENCE_LAYER_NAME,
  initializeGeneratedReferenceView
} from "./referenceViewController";
import { addGroupArtboardCanvasMargin, initializeGroupArtboardOverlay } from "./groupArtboardOverlay";
import {
  DEFAULT_ARTBOARD_BACKGROUND_COLOR,
  initializeArtboardBackgrounds
} from "./artboardBackgroundController";

const EDITABLE_CANVAS_PLACED_SIZE = 148;

export interface BatchProgress {
  stage: string;
  completed: number;
  total: number;
}

export interface BatchGenerationOptions {
  workbook: ImportedWorkbook;
  sheetName: string;
  selectedGroups: SheetGroup[];
  items: AssetCandidate[];
  template: PsdTemplate;
  editableCanvasSize: number;
  suggestedBaseName: string;
  onProgress?: (progress: BatchProgress) => void;
}

interface ModalExecutionContext {
  isCancelled: boolean;
  reportProgress?(options: { value: number; commandName?: string }): void;
  hostControl: {
    registerAutoCloseDocument(documentId: number): Promise<void> | void;
    unregisterAutoCloseDocument(documentId: number): Promise<void> | void;
  };
}

interface VolumeResult {
  psdFileName: string;
  items: AssetCandidate[];
  volumeNumber: number;
}

export async function generateBatch(options: BatchGenerationOptions): Promise<VolumeResult[]> {
  assertEditableCanvasSize(options.editableCanvasSize);
  const validItems = options.items.filter((item) => item.selected);
  if (!validItems.length) throw new Error("没有选择可生成项目。");
  const blocking = validItems.flatMap((item) => item.issues.filter((issue) => issue.severity === "error"));
  if (blocking.length) throw new Error(`已选项目仍有 ${blocking.length} 个阻断错误。`);
  const volumes = splitIntoVolumes(validItems, options.template.layout.maxArtboardsPerDocument);
  const suggestedBaseName = sanitizeFileName(options.suggestedBaseName);
  const suggestedFirstPsdName = volumes.length === 1
    ? `${suggestedBaseName}.psd`
    : `${suggestedBaseName}_01.psd`;
  const firstPsdFile = await selectPsdOutput(suggestedFirstPsdName);
  const outputFolder = await parentFolderForFile(firstPsdFile);
  const outputNames = buildBatchOutputNamesFromFirstPsd(firstPsdFile.name, volumes.length);
  await assertSubsequentOutputNamesAvailable(outputFolder, outputNames);
  const results: VolumeResult[] = [];
  const incompleteOutputFiles = new Set<storage.File>();
  const temporaryFolder = await storage.localFileSystem.getTemporaryFolder();
  const editableCanvasSource = await temporaryFolder.createFile(
    `psd-archive-editable-canvas-${Date.now()}.psb`,
    { overwrite: true }
  );
  const total = validItems.length;
  let completed = 0;

  try {
    await core.executeAsModal(
      async (executionContext) => {
        const context = executionContext as unknown as ModalExecutionContext;
        await createEditableCanvasSource(editableCanvasSource, context, options.editableCanvasSize);
        const editableCanvasToken = storage.localFileSystem.createSessionToken(editableCanvasSource);

        for (let volumeIndex = 0; volumeIndex < volumes.length; volumeIndex += 1) {
          assertNotCancelled(context);
          const volumeItems = volumes[volumeIndex]!;
          const layout = addGroupArtboardCanvasMargin(layoutItems(volumeItems, options.template));
          const names = outputNames[volumeIndex]!;
          const psdFileName = names.psd;
          const psdFile = volumeIndex === 0
            ? firstPsdFile
            : await outputFolder.createFile(psdFileName);
          incompleteOutputFiles.add(psdFile);
          const document = await app.createDocument({
            width: layout.width,
            height: layout.height,
            resolution: options.template.document.resolution,
            mode: constants.NewDocumentMode.RGB,
            fill: constants.DocumentFill.TRANSPARENT,
            name: psdFileName.replace(/\.psd$/i, "")
          } as never);
          if (!document) throw new Error("Photoshop 未能创建批量归档文档。");
          await context.hostControl.registerAutoCloseDocument(document.id);
          const initialLayerIds = document.layers.map((layer) => layer.id);
          const itemArtboardIds: number[] = [];

          for (let itemIndex = 0; itemIndex < layout.placements.length; itemIndex += 1) {
            assertNotCancelled(context);
            const placement = layout.placements[itemIndex]!;
            const image = selectedImage(placement.item);
            let temporaryImage: storage.File | null = null;
            if (image) {
              const bytes = await options.workbook.reader.archive.readBinary(image.anchor.archiveEntry);
              const extension = image.anchor.mediaType === "jpeg"
                ? "jpg"
                : image.anchor.mediaType === "png"
                  ? "png"
                  : extensionOf(image.anchor.archiveEntry);
              temporaryImage = await writeTemporaryImageWithName(bytes, placement.item.assetCode, extension);
            }
            try {
              const beforeIds = new Set(document.layers.map((layer) => layer.id));
              await action.batchPlay([makeArtboardDescriptor(placement.item.assetCode, placement.rect)], {});
              const artboard =
                document.layers.find((layer) => !beforeIds.has(layer.id)) ??
                document.layers.find((layer) => layer.name === placement.item.assetCode);
              if (!artboard) throw new Error(`未能创建画板${placement.item.assetCode ? `：${placement.item.assetCode}` : ""}`);
              itemArtboardIds.push(artboard.id);

              if (itemIndex === 0) {
                for (const layerId of initialLayerIds) {
                  const baseLayer = document.layers.find((layer) => layer.id === layerId);
                  if (baseLayer) await baseLayer.delete();
                }
              }

              if (temporaryImage) {
                const token = storage.localFileSystem.createSessionToken(temporaryImage);
                await action.batchPlay([placeEmbeddedDescriptor(token)], {});
                const placedLayer = document.activeLayers[0];
                if (!placedLayer) throw new Error(`图片置入失败：${placement.item.assetCode}`);
                placedLayer.name = REFERENCE_LAYER_NAME;
                await placedLayer.move(artboard, constants.ElementPlacement.PLACEINSIDE);
                await fitLayer(placedLayer, placement.rect, options.template);
              }

              await action.batchPlay([placeEmbeddedDescriptor(editableCanvasToken)], {});
              const editableCanvasLayer = document.activeLayers[0];
              if (!editableCanvasLayer) throw new Error(`空白智能对象置入失败：${placement.item.assetCode}`);
              editableCanvasLayer.name = editableCanvasLayerName(options.editableCanvasSize);
              await editableCanvasLayer.move(artboard, constants.ElementPlacement.PLACEINSIDE);
              await fitEditableCanvasLayer(editableCanvasLayer, placement.rect);

            } finally {
              if (temporaryImage) await deleteTemporaryFile(temporaryImage);
            }

            completed += 1;
            const stage = `生成 ${placement.item.assetCode}`;
            context.reportProgress?.({ value: completed / total, commandName: stage });
            options.onProgress?.({ stage, completed, total });
            await Promise.resolve();
          }

          await initializeArtboardBackgrounds(
            document,
            itemArtboardIds,
            DEFAULT_ARTBOARD_BACKGROUND_COLOR
          );
          await initializeGroupArtboardOverlay(
            document,
            layout,
            options.selectedGroups,
            itemArtboardIds,
            { color: DEFAULT_ARTBOARD_BACKGROUND_COLOR, visible: true }
          );
          await initializeGeneratedReferenceView(document);
          await document.saveAs.psd(psdFile as never);

          const volumeResult = { psdFileName, items: volumeItems, volumeNumber: volumeIndex + 1 };
          incompleteOutputFiles.delete(psdFile);
          await context.hostControl.unregisterAutoCloseDocument(document.id);
          results.push(volumeResult);
        }
      },
      { commandName: "生成棋子归档 PSD" }
    );
  } catch (error) {
    await cleanupIncompleteOutputs(incompleteOutputFiles);
    const normalized = normalizeGenerationError(error, completed, total);
    if (!(normalized instanceof UserCancelledError) && results.length) {
      throw new Error(`第 ${results.length + 1} 卷生成失败；前 ${results.length} 卷已完整保留。${toErrorMessage(normalized)}`);
    }
    throw normalized;
  } finally {
    await deleteTemporaryFile(editableCanvasSource);
  }

  return results;
}

async function assertSubsequentOutputNamesAvailable(
  folder: storage.Folder,
  outputNames: ReturnType<typeof buildBatchOutputNamesFromFirstPsd>
): Promise<void> {
  const plannedNames = outputNames.slice(1).map((names) => names.psd);
  if (!plannedNames.length) return;

  const existingNames = await listFolderFileNames(folder);
  const conflicts = findOutputNameConflicts(plannedNames, existingNames);

  if (conflicts.length) {
    const preview = conflicts.slice(0, 4).join("、");
    const remaining = conflicts.length > 4 ? ` 等 ${conflicts.length} 个文件` : "";
    throw new Error(`输出目录中已存在后续分卷 ${preview}${remaining}。请重新生成并在保存弹窗中使用其他名称。`);
  }
}

async function createEditableCanvasSource(
  outputFile: storage.File,
  context: ModalExecutionContext,
  size: number
): Promise<void> {
  const sourceDocument = await app.createDocument({
    width: size,
    height: size,
    resolution: 300,
    mode: constants.NewDocumentMode.RGB,
    fill: constants.DocumentFill.TRANSPARENT,
    name: `棋子归档_${size}空白智能对象`
  } as never);
  if (!sourceDocument) throw new Error(`Photoshop 未能创建 ${size}×${size} 空白智能对象源文档。`);

  await context.hostControl.registerAutoCloseDocument(sourceDocument.id);
  try {
    const editableLayer = sourceDocument.layers[0];
    if (editableLayer) editableLayer.name = "在此编辑";
    await sourceDocument.saveAs.psb(
      outputFile as never,
      { layers: true, maximizeCompatibility: true, embedColorProfile: true } as never,
      false
    );
  } finally {
    await context.hostControl.unregisterAutoCloseDocument(sourceDocument.id);
    sourceDocument.closeWithoutSaving();
  }
}

function assertEditableCanvasSize(size: number): void {
  if (!isValidEditableCanvasSize(size)) {
    throw new Error(
      `智能对象边长请输入 ${MIN_EDITABLE_CANVAS_SIZE}–${MAX_EDITABLE_CANVAS_SIZE} 之间的整数。`
    );
  }
}

async function writeTemporaryImageWithName(
  bytes: Uint8Array,
  assetCode: string,
  extension: string
): Promise<storage.File> {
  const folder = await storage.localFileSystem.getTemporaryFolder();
  const file = await folder.createFile(`${sanitizeFileName(assetCode)}-${Date.now()}.${extension}`, { overwrite: true });
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  await file.write(copy, { format: storage.formats.binary });
  return file;
}

async function fitLayer(
  layer: { boundsNoEffects: { left: number; top: number; right: number; bottom: number }; scale: Function; translate: Function },
  artboardRect: { left: number; top: number },
  template: PsdTemplate
): Promise<void> {
  const bounds = numericBounds(layer.boundsNoEffects);
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  if (!(width > 0) || !(height > 0)) throw new Error("置入图层边界为空。")
  const { scale } = calculateContainTransform({
    source: bounds,
    maxWidth: template.placement.maxVisibleWidth,
    maxHeight: template.placement.maxVisibleHeight,
    targetCenterX: artboardRect.left + template.placement.targetCenterX,
    targetCenterY: artboardRect.top + template.placement.targetCenterY,
    allowUpscale: template.placement.allowUpscale,
    pixelEnvelopeMargin: 0.5
  });
  if (Math.abs(scale - 1) > 0.0001) {
    await layer.scale(scale * 100, scale * 100, constants.AnchorPosition.MIDDLECENTER);
  }
  const fitted = numericBounds(layer.boundsNoEffects);
  const centerX = (fitted.left + fitted.right) / 2;
  const centerY = (fitted.top + fitted.bottom) / 2;
  await layer.translate(
    artboardRect.left + template.placement.targetCenterX - centerX,
    artboardRect.top + template.placement.targetCenterY - centerY
  );
}

async function fitEditableCanvasLayer(
  layer: { id: number; scale: Function; translate: Function },
  artboardRect: { left: number; top: number; right: number; bottom: number }
): Promise<void> {
  const bounds = await readSmartObjectTransformBounds(layer.id);
  const width = bounds.right - bounds.left;
  const height = bounds.bottom - bounds.top;
  if (!(width > 0) || !(height > 0)) throw new Error("空白智能对象变换边界为空。");

  const targetCenterX = (artboardRect.left + artboardRect.right) / 2;
  const targetCenterY = (artboardRect.top + artboardRect.bottom) / 2;
  const { scale } = calculateContainTransform({
    source: bounds,
    maxWidth: EDITABLE_CANVAS_PLACED_SIZE,
    maxHeight: EDITABLE_CANVAS_PLACED_SIZE,
    targetCenterX,
    targetCenterY,
    allowUpscale: true
  });
  await layer.scale(scale * 100, scale * 100, constants.AnchorPosition.MIDDLECENTER);

  const fitted = await readSmartObjectTransformBounds(layer.id);
  const centerX = (fitted.left + fitted.right) / 2;
  const centerY = (fitted.top + fitted.bottom) / 2;
  await layer.translate(targetCenterX - centerX, targetCenterY - centerY);
}

async function readSmartObjectTransformBounds(layerId: number) {
  const [descriptor] = await action.batchPlay(
    [{
      _obj: "get",
      _target: [
        { _property: "smartObjectMore" },
        { _ref: "layer", _id: layerId }
      ],
      _options: { dialogOptions: "dontDisplay" }
    }],
    {}
  );
  return smartObjectBoundsFromDescriptor(descriptor);
}

function selectedImage(item: AssetCandidate) {
  return item.imageCandidates.find((candidate) => candidate.id === item.selectedImageId);
}

function assertNotCancelled(context: ModalExecutionContext): void {
  if (context.isCancelled) throw new UserCancelledError("用户已取消生成任务。")
}

async function cleanupIncompleteOutputs(files: Set<storage.File>): Promise<void> {
  for (const file of files) {
    try {
      await file.delete();
    } catch (error) {
      if (/no such file|not found|不存在/i.test(error instanceof Error ? error.message : String(error))) continue;
      console.warn("清理未完成 PSD 失败", file.name, error);
    }
  }
}

function numericBounds(bounds: { left: number; top: number; right: number; bottom: number }) {
  return { left: Number(bounds.left), top: Number(bounds.top), right: Number(bounds.right), bottom: Number(bounds.bottom) };
}

function extensionOf(entry: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(entry);
  return match?.[1]?.toLowerCase() || "bin";
}
