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
  diagnostics?: HolopixImageBlobRuntimeDiagnostics;
}

export interface HolopixImageBlobRuntimeDiagnostics {
  windowImageBlob: string;
  globalThisImageBlob: string;
  createObjectURL: string;
  uxpVersion: string;
  pluginVersion: string;
  photoshopVersion: string;
  userAgent: string;
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
  diagnostic?: string;
  revoke(): void;
}

export interface UncompressedRgbaPreview {
  width: number;
  height: number;
  pixels: Uint8Array | Uint8ClampedArray;
}

export type HolopixImageBlobStage =
  | "validation"
  | "constructor-availability"
  | "constructor"
  | "object-url"
  | "image-element"
  | "ready";

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
  try {
    validatePreview(preview);
  } catch (error) {
    throw new Error(describeHolopixImageBlobFailure(
      "validation",
      errorMessage(error),
      preview,
      runtime
    ));
  }
  if (!runtime.ImageBlob) {
    throw new Error(describeHolopixImageBlobFailure(
      "constructor-availability",
      "当前 Photoshop UXP 面板上下文没有暴露 ImageBlob 构造器。",
      preview,
      runtime
    ));
  }

  // Photoshop 25.4 exposes ImageBlob but rejects ArrayBuffer at runtime even
  // though the API names the argument arrayBuffer. A concrete Uint8Array is
  // accepted and preserves the decoded RGBA bytes without another codec pass.
  const pixels = new Uint8Array(preview.pixels.byteLength);
  pixels.set(preview.pixels);
  let imageBlob: unknown;
  try {
    imageBlob = new runtime.ImageBlob(pixels, {
      type: "image/uncompressed",
      width: preview.width,
      height: preview.height,
      colorSpace: "RGB",
      pixelFormat: "RGBA",
      components: 4,
      componentSize: 8,
      hasAlpha: true
    });
  } catch (error) {
    throw new Error(describeHolopixImageBlobFailure(
      "constructor",
      errorMessage(error),
      preview,
      runtime
    ));
  }
  let url: string;
  try {
    url = runtime.createObjectURL(imageBlob);
  } catch (error) {
    throw new Error(describeHolopixImageBlobFailure(
      "object-url",
      errorMessage(error),
      preview,
      runtime
    ));
  }
  if (!url) {
    throw new Error(describeHolopixImageBlobFailure(
      "object-url",
      "Photoshop UXP 返回了空 Object URL。",
      preview,
      runtime
    ));
  }

  let active = true;
  return {
    url,
    retainedSource: { imageBlob, pixels },
    diagnostic: describeHolopixImageBlobFailure(
      "ready",
      "ImageBlob 与 Object URL 已创建，等待 HTMLImageElement 加载。",
      preview,
      runtime
    ),
    revoke: () => {
      if (!active) return;
      active = false;
      runtime.revokeObjectURL(url);
    }
  };
}

export function describeHolopixImageBlobFailure(
  stage: HolopixImageBlobStage,
  detail: string,
  preview?: Pick<UncompressedRgbaPreview, "width" | "height" | "pixels">,
  runtime = defaultImageBlobRuntime()
): string {
  const diagnostics = runtime.diagnostics;
  const previewDetail = preview
    ? `${preview.width}x${preview.height}/RGBA/${preview.pixels.byteLength}bytes`
    : "unknown";
  return [
    "ImageBlob 诊断",
    `stage=${stage}`,
    `preview=${previewDetail}`,
    `runtime.ImageBlob=${valueKind(runtime.ImageBlob)}`,
    `window.ImageBlob=${diagnostics?.windowImageBlob ?? "not-recorded"}`,
    `globalThis.ImageBlob=${diagnostics?.globalThisImageBlob ?? "not-recorded"}`,
    `URL.createObjectURL=${diagnostics?.createObjectURL ?? "not-recorded"}`,
    `UXP=${diagnostics?.uxpVersion ?? "not-recorded"}`,
    `plugin=${diagnostics?.pluginVersion ?? "not-recorded"}`,
    `Photoshop=${diagnostics?.photoshopVersion ?? "not-recorded"}`,
    `userAgent=${diagnostics?.userAgent ?? "not-recorded"}`,
    `detail=${detail}`
  ].join("；");
}

function defaultImageBlobRuntime(): HolopixImageBlobRuntime {
  const scope = window as typeof window & {
    ImageBlob?: HolopixImageBlobRuntime["ImageBlob"];
    require?: (moduleName: string) => unknown;
  };
  const globalScope = globalThis as typeof globalThis & {
    ImageBlob?: HolopixImageBlobRuntime["ImageBlob"];
  };
  return {
    ImageBlob: scope.ImageBlob,
    createObjectURL: (value) => URL.createObjectURL(value as Blob),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
    diagnostics: {
      windowImageBlob: valueKind(scope.ImageBlob),
      globalThisImageBlob: valueKind(globalScope.ImageBlob),
      createObjectURL: valueKind(URL.createObjectURL),
      ...readHostVersions(scope),
      userAgent: typeof navigator === "undefined" ? "unavailable" : navigator.userAgent || "empty"
    }
  };
}

function readHostVersions(scope: { require?: (moduleName: string) => unknown }): Pick<
  HolopixImageBlobRuntimeDiagnostics,
  "uxpVersion" | "pluginVersion" | "photoshopVersion"
> {
  let uxpVersion = "unavailable";
  let pluginVersion = "unavailable";
  let photoshopVersion = "unavailable";
  try {
    const uxpModule = scope.require?.("uxp") as {
      versions?: { uxp?: string; plugin?: string };
    } | undefined;
    uxpVersion = uxpModule?.versions?.uxp ?? "missing";
    pluginVersion = uxpModule?.versions?.plugin ?? "missing";
  } catch (error) {
    uxpVersion = `error:${errorMessage(error)}`;
    pluginVersion = uxpVersion;
  }
  try {
    const photoshopModule = scope.require?.("photoshop") as {
      app?: { version?: string };
    } | undefined;
    photoshopVersion = photoshopModule?.app?.version ?? "missing";
  } catch (error) {
    photoshopVersion = `error:${errorMessage(error)}`;
  }
  return { uxpVersion, pluginVersion, photoshopVersion };
}

function valueKind(value: unknown): string {
  if (typeof value !== "function") return typeof value;
  return value.name ? `function:${value.name}` : "function:anonymous";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? `${error.name}:${error.message}` : String(error);
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
