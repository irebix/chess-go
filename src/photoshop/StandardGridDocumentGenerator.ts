import { action, app, constants, core } from "photoshop";
import { storage } from "uxp";
import {
  GRID_BACKGROUND_LAYER_NAME,
  STANDARD_GRID_TEMPLATE
} from "../grid/GridTemplate";
import {
  initializeGridMetadataStore,
  readGridMetadataStore
} from "../grid/GridMetadataStore";
import { selectPsdOutput } from "../infrastructure/filesystem/uxpFiles";
import { placeEmbeddedDescriptor } from "./actionDescriptors";
import {
  fitLayerInsideBounds,
  type TransformableLayerLike
} from "./layerPlacementGeometry";
import { inspectGridCanvas } from "./placementMode";
import { UserCancelledError } from "../utils/errors";

export const STANDARD_GRID_BACKGROUND_ASSET = "StandardGridBackground.png";
export const STANDARD_GRID_DEFAULT_PSD_NAME = "棋子go_标准网格画布.psd";

export interface StandardGridGenerationResult {
  documentId: number;
  fileName: string;
}

interface ModalExecutionContext {
  isCancelled: boolean;
  hostControl: {
    registerAutoCloseDocument(documentId: number): Promise<void> | void;
    unregisterAutoCloseDocument(documentId: number): Promise<void> | void;
  };
}

interface GridBackgroundLayer extends TransformableLayerLike {
  visible: boolean;
}

export async function generateStandardGridPsd(): Promise<StandardGridGenerationResult> {
  const background = await bundledGridBackground();
  const outputFile = await selectPsdOutput(STANDARD_GRID_DEFAULT_PSD_NAME);
  const backgroundToken = storage.localFileSystem.createSessionToken(background);
  let result: StandardGridGenerationResult | null = null;

  await core.executeAsModal(async (executionContext) => {
    const context = executionContext as unknown as ModalExecutionContext;
    assertNotCancelled(context);
    const document = await app.createDocument({
      width: STANDARD_GRID_TEMPLATE.canvas.width,
      height: STANDARD_GRID_TEMPLATE.canvas.height,
      resolution: 300,
      mode: constants.NewDocumentMode.RGB,
      fill: constants.DocumentFill.TRANSPARENT,
      name: outputFile.name.replace(/\.psd$/i, "")
    } as never);
    if (!document) throw new Error("Photoshop 未能创建标准网格文档。");
    await context.hostControl.registerAutoCloseDocument(document.id);

    const initialLayerIds = new Set(document.layers.map((layer) => layer.id));
    await action.batchPlay([placeEmbeddedDescriptor(backgroundToken)], {});
    const backgroundLayer = document.activeLayers[0] as unknown as GridBackgroundLayer | undefined;
    if (!backgroundLayer) throw new Error("标准网格背景置入后没有活动图层。");
    backgroundLayer.name = GRID_BACKGROUND_LAYER_NAME;
    backgroundLayer.visible = true;
    await fitLayerInsideBounds(
      backgroundLayer,
      {
        left: 0,
        top: 0,
        right: STANDARD_GRID_TEMPLATE.canvas.width,
        bottom: STANDARD_GRID_TEMPLATE.canvas.height
      },
      { allowUpscale: true, tolerance: 1 }
    );

    for (const layerId of initialLayerIds) {
      const initialLayer = document.layers.find((layer) => layer.id === layerId);
      if (initialLayer) await initialLayer.delete();
    }

    await initializeGridMetadataStore(document as never);
    const metadata = readGridMetadataStore(document as never);
    if (metadata.status !== "valid") {
      throw new Error("标准网格隐藏数据写入后校验失败。");
    }
    if (inspectGridCanvas(document).mode !== "STANDARD_GRID") {
      throw new Error("新文档没有被识别为棋子go标准网格画布。");
    }

    assertNotCancelled(context);
    await document.saveAs.psd(outputFile as never);
    await context.hostControl.unregisterAutoCloseDocument(document.id);
    result = {
      documentId: document.id,
      fileName: outputFile.name
    };
  }, { commandName: "棋子go · 生成标准网格画布" });

  if (!result) throw new Error("标准网格 PSD 生成后没有返回结果。");
  return result;
}

async function bundledGridBackground(): Promise<storage.File> {
  const provider = storage.localFileSystem;
  if (!provider.getPluginFolder) {
    throw new Error("当前 UXP 不支持读取标准网格背景资源。");
  }
  const folder = await provider.getPluginFolder();
  if (!folder.getEntry) throw new Error("当前 UXP 无法读取插件目录。");
  const entry = await folder.getEntry(STANDARD_GRID_BACKGROUND_ASSET);
  if (!entry.isFile) throw new Error("插件中的标准网格背景资源不是文件。");
  return entry as storage.File;
}

function assertNotCancelled(context: ModalExecutionContext): void {
  if (context.isCancelled) throw new UserCancelledError("已取消生成标准网格画布。");
}
