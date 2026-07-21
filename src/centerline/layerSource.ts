import { app, core, imaging, imaging_beta } from "photoshop";
import type { CenterlinePixelSource } from "./types";

interface PixelImageData {
  width: number;
  height: number;
  components: number;
  getData(options: { chunky: true }): Promise<Uint8Array | number[]>;
  dispose(): void;
}

interface PixelResult {
  imageData: PixelImageData;
  sourceBounds?: { left?: number; top?: number };
  level?: number;
}

function activeSource(): {
  documentId: number;
  documentName: string;
  layerId: number;
  layerName: string;
} {
  if (!app.documents?.length) throw new Error("请先打开 Photoshop 文档。");
  const document = app.activeDocument;
  const layer = document.activeLayers?.[0];
  if (!layer) throw new Error("请先选中一个需要勾线的图层。");
  return {
    documentId: document.id,
    documentName: document.title,
    layerId: layer.id,
    layerName: layer.name
  };
}

export function assertActiveLayerSource(source: CenterlinePixelSource): void {
  const current = activeSource();
  if (current.documentId !== source.documentId || current.layerId !== source.layerId) {
    throw new Error("任务执行期间活动文档或图层已改变；已停止写入 Photoshop。");
  }
}

export async function readActiveLayerPixels(): Promise<CenterlinePixelSource> {
  const identity = activeSource();
  const imagingApi = imaging ?? imaging_beta;
  if (!imagingApi) throw new Error("当前 Photoshop 不支持 Imaging API。");

  let result: CenterlinePixelSource | null = null;
  await core.executeAsModal(async () => {
    const current = activeSource();
    if (current.documentId !== identity.documentId || current.layerId !== identity.layerId) {
      throw new Error("读取像素前活动文档或图层已改变。");
    }
    const imageObject = await imagingApi.getPixels({
      documentID: identity.documentId,
      layerID: identity.layerId,
      colorSpace: "RGB",
      componentSize: 8,
      applyAlpha: false
    }) as unknown as PixelResult;
    try {
      const raw = await imageObject.imageData.getData({ chunky: true });
      const bytes = raw instanceof Uint8Array ? raw : Uint8Array.from(raw);
      const level = Number(imageObject.level ?? 0);
      const coordinateScale = 2 ** level;
      const bounds = imageObject.sourceBounds ?? { left: 0, top: 0 };
      result = {
        ...identity,
        bytes,
        width: Number(imageObject.imageData.width),
        height: Number(imageObject.imageData.height),
        components: Number(imageObject.imageData.components),
        transform: {
          scaleX: coordinateScale,
          scaleY: coordinateScale,
          offsetX: Number(bounds.left ?? 0) * coordinateScale,
          offsetY: Number(bounds.top ?? 0) * coordinateScale
        }
      };
    } finally {
      imageObject.imageData.dispose();
    }
  }, { commandName: "AI勾线 · 读取当前图层" });
  if (!result) throw new Error("Photoshop 未返回当前图层像素。");
  return result;
}
