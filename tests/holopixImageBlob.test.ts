import { describe, expect, it, vi } from "vitest";
import {
  createHolopixImageBlobResource,
  type HolopixImageBlobOptions,
  type HolopixImageBlobRuntime
} from "../src/ai/holopixImageBlob";

describe("Holopix ImageBlob preview", () => {
  it("creates an uncompressed RGBA ImageBlob from an exact pixel buffer", () => {
    const received: { bytes?: number[]; options?: HolopixImageBlobOptions } = {};
    class FakeImageBlob {
      constructor(data: Uint8Array, options: HolopixImageBlobOptions) {
        expect(data).toBeInstanceOf(Uint8Array);
        expect(data).not.toBe(pixels);
        received.bytes = Array.from(data);
        received.options = options;
      }
    }
    const revokeObjectURL = vi.fn();
    const backing = new Uint8ClampedArray([99, 99, 10, 20, 30, 255, 40, 50, 60, 255, 88]);
    const pixels = backing.subarray(2, 10);
    const runtime: HolopixImageBlobRuntime = {
      ImageBlob: FakeImageBlob,
      createObjectURL: () => "blob:chess-go-preview",
      revokeObjectURL
    };

    const resource = createHolopixImageBlobResource({ width: 1, height: 2, pixels }, runtime);

    expect(received.bytes).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
    expect(received.options).toEqual({
      type: "image/uncompressed",
      width: 1,
      height: 2,
      colorSpace: "RGB",
      pixelFormat: "RGBA",
      components: 4,
      componentSize: 8,
      hasAlpha: true
    });
    expect(resource.url).toBe("blob:chess-go-preview");

    resource.revoke();
    resource.revoke();
    expect(revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:chess-go-preview");
  });

  it("rejects an invalid RGBA buffer before creating an ImageBlob", () => {
    const runtime: HolopixImageBlobRuntime = {
      ImageBlob: class {},
      createObjectURL: () => "unused",
      revokeObjectURL: () => undefined
    };

    expect(() => createHolopixImageBlobResource({
      width: 2,
      height: 2,
      pixels: new Uint8ClampedArray(4)
    }, runtime)).toThrow(/RGBA 像素长度/);
  });

  it("reports an unsupported host so the UI can retain the Canvas fallback", () => {
    expect(() => createHolopixImageBlobResource({
      width: 1,
      height: 1,
      pixels: new Uint8ClampedArray([0, 0, 0, 255])
    }, {
      ImageBlob: undefined,
      createObjectURL: () => "unused",
      revokeObjectURL: () => undefined
    })).toThrow(/不支持 ImageBlob/);
  });
});
