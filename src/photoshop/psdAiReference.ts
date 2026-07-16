import { core, imaging, imaging_beta } from "photoshop";
import type { HolopixImageBlobResource } from "../ai/holopixImageBlob";
import type { PsdAiNode } from "./referenceViewController";

export interface PsdAiReference extends PsdAiNode {
  documentId: number;
}

let referenceReadQueue: Promise<void> = Promise.resolve();

export async function readPsdAiReferenceJpeg(
  reference: PsdAiReference,
  targetHeight = 1024
): Promise<Uint8Array> {
  return runReferenceReadModal(`读取 ${reference.assetCode} 参考图`, async () => {
    const encoded = await encodePsdAiReference(reference, targetHeight, false);
    if (typeof encoded === "string") throw new Error("Photoshop 返回了非预期的 Base64 参考图数据。");
    return Uint8Array.from(encoded);
  });
}

export async function readPsdAiReferencePreview(
  reference: PsdAiReference,
  targetHeight = 128
): Promise<HolopixImageBlobResource> {
  return runReferenceReadModal(`预览 ${reference.assetCode} 参考图`, async () => {
    const encoded = await encodePsdAiReference(reference, targetHeight, true);
    if (typeof encoded !== "string") {
      throw new Error("Photoshop 未返回 Base64 参考图缩略图。");
    }
    return {
      url: `data:image/jpeg;base64,${encoded}`,
      revoke: () => undefined
    };
  });
}

async function encodePsdAiReference(
  reference: PsdAiReference,
  targetHeight: number,
  base64: boolean
): Promise<number[] | string> {
  validateTargetHeight(targetHeight);
  const result = await readPsdAiReferencePixels(reference, targetHeight, true);
  const imagingApi = imaging ?? imaging_beta;
  if (!imagingApi) throw new Error("当前 Photoshop 不支持编码 PSD 参考图像素。");
  try {
    if (result.imageData.width < 1 || result.imageData.height < 1) {
      throw new Error("图层没有可编码的像素。");
    }
    const encoded = await imagingApi.encodeImageData({ imageData: result.imageData, base64 });
    if ((typeof encoded === "string" && !encoded) || (Array.isArray(encoded) && !encoded.length)) {
      throw new Error("Photoshop 返回了空的 JPEG 数据。");
    }
    return encoded;
  } catch (error) {
    throw new Error(
      `PSD 参考图 ${reference.assetCode}（图层 ${reference.referenceLayerId}）编码失败：${errorMessage(error)}`
    );
  } finally {
    result.imageData.dispose();
  }
}

async function readPsdAiReferencePixels(
  reference: PsdAiReference,
  targetHeight: number,
  applyAlpha: boolean
) {
  const imagingApi = imaging ?? imaging_beta;
  if (!imagingApi) throw new Error("当前 Photoshop 不支持只读提取 PSD 参考图像素。");
  const pixelOptions = {
    documentID: reference.documentId,
    layerID: reference.referenceLayerId,
    targetSize: { height: targetHeight },
    colorSpace: "RGB" as const,
    componentSize: 8 as const,
    applyAlpha
  };
  let result;
  try {
    result = await imagingApi.getPixels({
      ...pixelOptions,
      colorProfile: "sRGB IEC61966-2.1"
    });
  } catch (profileError) {
    try {
      // Some Photoshop installations expose a localized or incomplete RGB profile list.
      // Omitting the profile lets Imaging use the document/working RGB profile.
      result = await imagingApi.getPixels(pixelOptions);
    } catch (fallbackError) {
      throw new Error(
        `PSD 参考图 ${reference.assetCode}（图层 ${reference.referenceLayerId}）只读取像失败：${errorMessage(fallbackError)}；首次读取：${errorMessage(profileError)}`
      );
    }
  }
  return result;
}

function runReferenceReadModal<T>(
  commandName: string,
  operation: () => Promise<T>
): Promise<T> {
  const run = async (): Promise<T> => {
    let value: T | undefined;
    await core.executeAsModal(
      async () => {
        value = await operation();
      },
      { commandName }
    );
    if (value === undefined) throw new Error("Photoshop 未返回参考图读取结果。");
    return value;
  };
  const task = referenceReadQueue.then(run, run);
  referenceReadQueue = task.then(() => undefined, () => undefined);
  return task;
}

function validateTargetHeight(targetHeight: number): void {
  if (!Number.isInteger(targetHeight) || targetHeight < 32 || targetHeight > 2048) {
    throw new Error("PSD 参考图读取尺寸无效。");
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
