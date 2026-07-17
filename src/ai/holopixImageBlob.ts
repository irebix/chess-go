import type { AiCandidatePreview } from "../domain/aiCandidates";

export interface HolopixImageBlobOptions {
  type: "image/uncompressed";
  width: number;
  height: number;
  colorSpace: "RGB";
  pixelFormat: "RGBA";
  components: 4;
  componentSize: 8;
  hasAlpha: true;
}

export interface HolopixImageBlobRuntime {
  ImageBlob?: new (data: Uint8Array, options: HolopixImageBlobOptions) => unknown;
  createObjectURL(value: unknown): string;
  revokeObjectURL(url: string): void;
}

export interface HolopixImageBlobResource {
  url: string;
  /**
   * Keep both the UXP ImageBlob wrapper and its byte storage alive for as long
   * as the Object URL is mounted. Photoshop may otherwise release the native
   * image backing while the URL string is still in use.
   */
  retainedSource?: {
    imageBlob: unknown;
    pixels: Uint8Array;
  };
  revoke(): void;
}

export interface UncompressedRgbaPreview {
  width: number;
  height: number;
  pixels: Uint8Array | Uint8ClampedArray;
}

export function createHolopixImageBlobResource(
  preview: AiCandidatePreview,
  runtime = defaultImageBlobRuntime()
): HolopixImageBlobResource {
  return createUncompressedRgbaImageBlobResource(preview, runtime);
}

export function createUncompressedRgbaImageBlobResource(
  preview: UncompressedRgbaPreview,
  runtime = defaultImageBlobRuntime()
): HolopixImageBlobResource {
  validatePreview(preview);
  if (!runtime.ImageBlob) {
    throw new Error("当前 Photoshop UXP 不支持 ImageBlob 原始像素预览。");
  }

  // Photoshop 25.4 exposes ImageBlob but rejects ArrayBuffer at runtime even
  // though the API names the argument arrayBuffer. A concrete Uint8Array is
  // accepted and preserves the decoded RGBA bytes without another codec pass.
  const pixels = new Uint8Array(preview.pixels.byteLength);
  pixels.set(preview.pixels);
  const imageBlob = new runtime.ImageBlob(pixels, {
    type: "image/uncompressed",
    width: preview.width,
    height: preview.height,
    colorSpace: "RGB",
    pixelFormat: "RGBA",
    components: 4,
    componentSize: 8,
    hasAlpha: true
  });
  const url = runtime.createObjectURL(imageBlob);
  if (!url) throw new Error("Photoshop UXP 未能为 ImageBlob 创建 Object URL。");

  let active = true;
  return {
    url,
    retainedSource: { imageBlob, pixels },
    revoke: () => {
      if (!active) return;
      active = false;
      runtime.revokeObjectURL(url);
    }
  };
}

function defaultImageBlobRuntime(): HolopixImageBlobRuntime {
  const scope = window as typeof window & {
    ImageBlob?: HolopixImageBlobRuntime["ImageBlob"];
  };
  return {
    ImageBlob: scope.ImageBlob,
    createObjectURL: (value) => URL.createObjectURL(value as Blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url)
  };
}

function validatePreview(preview: UncompressedRgbaPreview): void {
  if (!Number.isInteger(preview.width) || !Number.isInteger(preview.height)
    || preview.width < 1 || preview.height < 1) {
    throw new Error("Holopix ImageBlob 预览尺寸无效。");
  }
  if (preview.pixels.byteLength !== preview.width * preview.height * 4) {
    throw new Error("Holopix ImageBlob RGBA 像素长度无效。");
  }
}
