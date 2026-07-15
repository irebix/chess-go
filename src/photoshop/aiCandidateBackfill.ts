import { action, app, constants, core } from "photoshop";
import { storage } from "uxp";
import {
  artboardBoundsFromDescriptor,
  calculateAiCandidatePlacement
} from "../domain/aiCandidatePlacement";
import { deleteTemporaryFile } from "../infrastructure/filesystem/uxpFiles";
import {
  getArtboardDescriptor,
  replacePlacedLayerContentsDescriptor,
  selectLayerDescriptor
} from "./actionDescriptors";
import {
  findEditableCanvasLayer,
  findEditableCanvasTarget,
  type CandidateTargetLayer,
  type CandidateTargetDocument
} from "./aiCandidateTarget";
import { smartObjectBoundsFromDescriptor, type SmartObjectTransformBounds } from "./smartObjectBounds";

export interface CandidateBackfillResult {
  applied: boolean;
  detail: string;
}

export async function backfillAiCandidate(
  assetCode: string,
  imageUrl: string
): Promise<CandidateBackfillResult> {
  const document = activeDocument();
  if (!document) {
    return { applied: false, detail: "候选已选中；当前没有打开的棋子归档 PSD，未回填画板。" };
  }
  const target = findEditableCanvasLayer(document, assetCode);
  if (!target) {
    return { applied: false, detail: `候选已选中；当前 PSD 中未找到画板 ${assetCode} 的空白智能对象。` };
  }

  const response = await fetch(imageUrl);
  if (!response.ok) throw new Error(`下载 Holopix 候选图失败：HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const extension = extensionFromContentType(response.headers.get("content-type"));
  const folder = await storage.localFileSystem.getTemporaryFolder();
  const temporary = await folder.createFile(
    `chess-go-holopix-${safeFileName(assetCode)}-${Date.now()}.${extension}`,
    { overwrite: true }
  );
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  await temporary.write(copy, { format: storage.formats.binary });

  try {
    const token = storage.localFileSystem.createSessionToken(temporary);
    await core.executeAsModal(
      async () => {
        const currentDocument = activeDocument();
        if (!currentDocument) throw new Error("回填过程中当前 PSD 已关闭。");
        const currentTarget = findEditableCanvasTarget(currentDocument, assetCode);
        if (!currentTarget) throw new Error(`回填过程中未找到画板 ${assetCode} 的空白智能对象。`);
        const targetBounds = await readArtboardBounds(currentTarget.artboard.id);
        await action.batchPlay([
          selectLayerDescriptor(currentTarget.layer.id),
          replacePlacedLayerContentsDescriptor(token)
        ], {});
        await fitReplacementInsideTarget(currentTarget.layer, targetBounds);
      },
      { commandName: `回填 Holopix 候选：${assetCode}` }
    );
  } finally {
    await deleteTemporaryFile(temporary);
  }

  return { applied: true, detail: `已选中并回填画板 ${assetCode}；图片已限制在画板范围内。` };
}

async function readArtboardBounds(layerId: number): Promise<SmartObjectTransformBounds> {
  const [descriptor] = await action.batchPlay([getArtboardDescriptor(layerId)], {});
  return artboardBoundsFromDescriptor(descriptor);
}

async function fitReplacementInsideTarget(
  layer: CandidateTargetLayer,
  targetBounds: SmartObjectTransformBounds
): Promise<void> {
  if (!layer.scale || !layer.translate) throw new Error("当前 Photoshop 图层不支持回填后的缩放定位。");
  const sourceBounds = await readSmartObjectTransformBounds(layer.id);
  const placement = calculateAiCandidatePlacement(sourceBounds, targetBounds);
  if (Math.abs(placement.scale - 1) > 0.0001) {
    await layer.scale(
      placement.scale * 100,
      placement.scale * 100,
      constants.AnchorPosition.MIDDLECENTER
    );
  }
  const fitted = await readSmartObjectTransformBounds(layer.id);
  const centerX = (fitted.left + fitted.right) / 2;
  const centerY = (fitted.top + fitted.bottom) / 2;
  await layer.translate(
    placement.targetCenterX - centerX,
    placement.targetCenterY - centerY
  );
}

async function readSmartObjectTransformBounds(layerId: number): Promise<SmartObjectTransformBounds> {
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

function activeDocument(): CandidateTargetDocument | null {
  try {
    return app.activeDocument as unknown as CandidateTargetDocument;
  } catch {
    return null;
  }
}

function extensionFromContentType(contentType: string | null): string {
  if (/jpe?g/i.test(contentType ?? "")) return "jpg";
  if (/webp/i.test(contentType ?? "")) return "webp";
  return "png";
}

function safeFileName(value: string): string {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 80) || "candidate";
}
