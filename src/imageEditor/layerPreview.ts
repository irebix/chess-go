import { app, core, imaging, imaging_beta } from "photoshop";

const PREVIEW_TARGET_HEIGHT = 265;

export interface ImageEditorLayerSummary {
  documentId: number;
  documentName: string;
  layerId: number;
  layerName: string;
  width: number;
  height: number;
}

export function inspectActiveImageEditorLayer(): ImageEditorLayerSummary | null {
  try {
    if (!app.documents?.length) return null;
    const document = app.activeDocument;
    const layer = document.activeLayers?.[0];
    if (!layer) return null;
    const bounds = layer.boundsNoEffects ?? layer.bounds;
    const width = Math.max(0, Number(bounds.right) - Number(bounds.left));
    const height = Math.max(0, Number(bounds.bottom) - Number(bounds.top));
    if (!(width > 0) || !(height > 0)) return null;
    return {
      documentId: document.id,
      documentName: document.title,
      layerId: layer.id,
      layerName: layer.name,
      width: Math.round(width),
      height: Math.round(height)
    };
  } catch {
    return null;
  }
}

export interface ImageEditorLayerPreview extends ImageEditorLayerSummary {
  dataUrl: string;
}

/**
 * Mirrors Huatu's stable Photoshop-layer preview path: downsample with Imaging,
 * encode through Photoshop, and feed the compressed Base64 data URL directly to
 * an <img>. It deliberately never constructs ImageBlob from raw RGBA pixels.
 */
export async function readActiveImageEditorLayerPreview(): Promise<ImageEditorLayerPreview> {
  const source = inspectActiveImageEditorLayer();
  if (!source) throw new Error("没有可预览的选中图层。");
  const imagingApi = imaging ?? imaging_beta;
  if (!imagingApi?.getPixels || !imagingApi.encodeImageData) {
    throw new Error("当前 Photoshop 不支持图层预览。");
  }

  let preview: ImageEditorLayerPreview | undefined;
  await core.executeAsModal(async () => {
    const current = inspectActiveImageEditorLayer();
    if (
      !current
      || current.documentId !== source.documentId
      || current.layerId !== source.layerId
    ) {
      throw new Error("读取预览前活动图层已改变。");
    }
    const bounds = app.activeDocument.activeLayers[0]?.boundsNoEffects
      ?? app.activeDocument.activeLayers[0]?.bounds;
    if (!bounds) throw new Error("无法读取当前图层边界。");
    const pixels = await imagingApi.getPixels({
      documentID: source.documentId,
      layerID: source.layerId,
      sourceBounds: {
        left: Number(bounds.left),
        top: Number(bounds.top),
        right: Number(bounds.right),
        bottom: Number(bounds.bottom)
      },
      targetSize: { height: PREVIEW_TARGET_HEIGHT },
      colorSpace: "RGB",
      componentSize: 8,
      includeAlpha: true,
      applyAlpha: true
    });
    try {
      const encoded = await imagingApi.encodeImageData({
        imageData: pixels.imageData,
        base64: true
      });
      if (typeof encoded !== "string" || !encoded) {
        throw new Error("Photoshop 未返回 Base64 图层预览。");
      }
      preview = {
        ...source,
        dataUrl: `data:image/jpeg;base64,${encoded}`
      };
    } finally {
      pixels.imageData.dispose();
    }
  }, { commandName: "AI编辑 · 获取图层预览" });

  if (!preview) throw new Error("Photoshop 未返回图层预览。");
  return preview;
}
