import { encode } from "jpeg-js";
import { describe, expect, it } from "vitest";
import {
  buildHolopixSafeJpegUrl,
  decodeHolopixDirectJpeg,
  decodeHolopixSafeJpeg,
  HOLOPIX_SAFE_PREVIEW_MAX_BYTES,
  HOLOPIX_SAFE_PREVIEW_SIZE,
  prepareHolopixSafePreviewWorkflow
} from "../src/ai/holopixSafePreview";

const outputImage = {
  filename: "c_cleaning1_00005_.png",
  subfolder: "Holopix/ChessGo",
  type: "output"
};

describe("Holopix safe preview", () => {
  it("builds a zero-cost ComfyUI resize workflow for an existing output", () => {
    const prepared = prepareHolopixSafePreviewWorkflow(outputImage);

    expect(prepared.previewNodeId).toBe("3");
    expect(prepared.workflow["1"]).toMatchObject({
      class_type: "LoadImage",
      inputs: { image: "Holopix/ChessGo/c_cleaning1_00005_.png [output]" }
    });
    expect(prepared.workflow["2"]).toMatchObject({
      class_type: "ImageScale",
      inputs: {
        image: ["1", 0],
        width: 96,
        height: 96,
        crop: "center"
      }
    });
    expect(prepared.workflow["3"]).toMatchObject({
      class_type: "PreviewImage",
      inputs: { images: ["2", 0] }
    });
    expect(Object.values(prepared.workflow).some((node) => node.class_type.startsWith("Holopix"))).toBe(false);
  });

  it("requests a normalized RGB JPEG from the ComfyUI preview output", () => {
    const url = new URL(buildHolopixSafeJpegUrl({
      filename: "ComfyUI_temp_00001_.png",
      subfolder: "",
      type: "temp"
    }, "http://127.0.0.1:8188"));

    expect(url.origin).toBe("http://127.0.0.1:8188");
    expect(url.pathname).toBe("/view");
    expect(url.searchParams.get("preview")).toBe("jpeg;82");
    expect(url.searchParams.get("channel")).toBe("rgb");
  });

  it("decodes a canonical 96 by 96 JPEG into RGBA pixels without a browser image decoder", () => {
    const rgba = new Uint8Array(HOLOPIX_SAFE_PREVIEW_SIZE * HOLOPIX_SAFE_PREVIEW_SIZE * 4);
    for (let index = 0; index < rgba.length; index += 4) {
      rgba[index] = 35;
      rgba[index + 1] = 140;
      rgba[index + 2] = 220;
      rgba[index + 3] = 255;
    }
    const jpeg = encode({
      width: HOLOPIX_SAFE_PREVIEW_SIZE,
      height: HOLOPIX_SAFE_PREVIEW_SIZE,
      data: rgba
    }, 82).data;

    const preview = decodeHolopixSafeJpeg(new Uint8Array(jpeg), "image/jpeg; charset=binary");

    expect(preview.width).toBe(96);
    expect(preview.height).toBe(96);
    expect(preview.pixels).toBeInstanceOf(Uint8ClampedArray);
    expect(preview.pixels).toHaveLength(96 * 96 * 4);
  });

  it("rejects unsafe paths and malformed preview responses", () => {
    expect(() => prepareHolopixSafePreviewWorkflow({
      ...outputImage,
      subfolder: "../outside"
    })).toThrow(/无效路径/);
    expect(() => prepareHolopixSafePreviewWorkflow({
      ...outputImage,
      type: "temp"
    })).toThrow(/必须为 output/);
    expect(() => decodeHolopixSafeJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]), "image/png"))
      .toThrow(/格式无效/);
    expect(() => decodeHolopixSafeJpeg(
      new Uint8Array(HOLOPIX_SAFE_PREVIEW_MAX_BYTES + 1),
      "image/jpeg"
    )).toThrow(/超过上限/);
  });

  it("rejects a valid JPEG when its dimensions are not 96 by 96", () => {
    const jpeg = encode({
      width: 64,
      height: 64,
      data: new Uint8Array(64 * 64 * 4)
    }, 82).data;

    expect(() => decodeHolopixSafeJpeg(new Uint8Array(jpeg), "image/jpeg"))
      .toThrow(/尺寸必须为 96×96/);
  });

  it("decodes and center-crops a direct ComfyUI JPEG without using an image element", () => {
    const width = 128;
    const height = 64;
    const rgba = new Uint8Array(width * height * 4);
    for (let index = 0; index < rgba.length; index += 4) {
      rgba[index] = 40;
      rgba[index + 1] = 120;
      rgba[index + 2] = 220;
      rgba[index + 3] = 255;
    }
    const jpeg = encode({ width, height, data: rgba }, 82).data;

    const preview = decodeHolopixDirectJpeg(
      new Uint8Array(jpeg),
      "image/jpeg; charset=binary"
    );

    expect(preview.width).toBe(96);
    expect(preview.height).toBe(96);
    expect(preview.pixels).toHaveLength(96 * 96 * 4);
    expect(preview.pixels[3]).toBe(255);
  });
});
