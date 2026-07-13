import { action, app, constants, core } from "photoshop";
import { storage } from "uxp";
import { calculateContainTransform, type Rect } from "../domain/contain";
import { makeArtboardDescriptor, placeEmbeddedDescriptor } from "./actionDescriptors";

const ARTBOARD_NAME = "phase0_asset";

export interface GenerationProgress {
  stage: string;
  value: number;
}

export interface PhaseZeroGenerationOptions {
  imageFile: storage.File;
  outputFile: storage.File;
  onProgress?: (progress: GenerationProgress) => void;
}

interface ModalExecutionContext {
  isCancelled: boolean;
  reportProgress?(options: { value: number; commandName?: string }): void;
  hostControl: {
    registerAutoCloseDocument(documentId: number): Promise<void> | void;
    unregisterAutoCloseDocument(documentId: number): Promise<void> | void;
  };
}

export async function generatePhaseZeroPsd(options: PhaseZeroGenerationOptions): Promise<void> {
  const imageToken = storage.localFileSystem.createSessionToken(options.imageFile);

  await core.executeAsModal(
    async (executionContext) => {
      const context = executionContext as unknown as ModalExecutionContext;
      report(context, options, "创建 148×148 文档", 0.1);
      assertNotCancelled(context);

      const document = await app.createDocument({
        width: 148,
        height: 148,
        resolution: 300,
        mode: constants.NewDocumentMode.RGB,
        fill: constants.DocumentFill.TRANSPARENT,
        name: "棋子归档_Phase0"
      } as never);
      if (!document) {
        throw new Error("Photoshop 未能创建 Phase 0 文档。")
      }
      await context.hostControl.registerAutoCloseDocument(document.id);

      report(context, options, "创建画板", 0.25);
      await action.batchPlay(
        [makeArtboardDescriptor(ARTBOARD_NAME, { left: 0, top: 0, right: 148, bottom: 148 })],
        {}
      );
      const artboard = document.layers.find((layer) => layer.name === ARTBOARD_NAME);
      if (!artboard) {
        throw new Error("Photoshop 已执行画板命令，但未返回目标画板图层。")
      }

      report(context, options, "嵌入图片为智能对象", 0.45);
      assertNotCancelled(context);
      await action.batchPlay([placeEmbeddedDescriptor(imageToken)], {});
      const placedLayer = document.activeLayers[0];
      if (!placedLayer) {
        throw new Error("图片置入后未找到活动图层。")
      }
      placedLayer.name = ARTBOARD_NAME;
      await placedLayer.move(artboard, constants.ElementPlacement.PLACEINSIDE);

      report(context, options, "按 contain 规则缩放和定位", 0.65);
      const initialBounds = toRect(placedLayer.boundsNoEffects);
      const transform = calculateContainTransform({
        source: initialBounds,
        maxWidth: 146,
        maxHeight: 134,
        targetCenterX: 74,
        targetCenterY: 78,
        allowUpscale: false,
        pixelEnvelopeMargin: 0.5
      });
      if (Math.abs(transform.scale - 1) > 0.0001) {
        await placedLayer.scale(
          transform.scale * 100,
          transform.scale * 100,
          constants.AnchorPosition.MIDDLECENTER
        );
      }

      const fittedBounds = toRect(placedLayer.boundsNoEffects);
      const fittedCenterX = (fittedBounds.left + fittedBounds.right) / 2;
      const fittedCenterY = (fittedBounds.top + fittedBounds.bottom) / 2;
      await placedLayer.translate(74 - fittedCenterX, 78 - fittedCenterY);

      const originalLayer = document.layers.find((layer) => layer.id !== artboard.id);
      if (originalLayer && originalLayer.id !== placedLayer.id) {
        await originalLayer.delete();
      }

      report(context, options, "保存 PSD", 0.85);
      assertNotCancelled(context);
      await document.saveAs.psd(options.outputFile as never);

      await context.hostControl.unregisterAutoCloseDocument(document.id);
      report(context, options, "完成", 1);
    },
    { commandName: "生成棋子归档 PSD（Phase 0）" }
  );
}

function assertNotCancelled(context: ModalExecutionContext): void {
  if (context.isCancelled) {
    throw new Error("Photoshop 已取消生成任务。")
  }
}

function report(
  context: ModalExecutionContext,
  options: PhaseZeroGenerationOptions,
  stage: string,
  value: number
): void {
  context.reportProgress?.({ value, commandName: stage });
  options.onProgress?.({ stage, value });
}

function toRect(bounds: { left: number; top: number; right: number; bottom: number }): Rect {
  return {
    left: Number(bounds.left),
    top: Number(bounds.top),
    right: Number(bounds.right),
    bottom: Number(bounds.bottom)
  };
}
