import { afterEach, describe, expect, it, vi } from "vitest";
import { CenterlineComfyClient } from "../src/centerline/client";
import type { CenterlinePixelSource } from "../src/centerline/types";

const sourcePromptId = "11111111-1111-4111-8111-111111111111";
const refitPromptId = "22222222-2222-4222-8222-222222222222";

function pixelSource(): CenterlinePixelSource {
  return {
    documentId: 1,
    documentName: "outline.psd",
    layerId: 2,
    layerName: "Source",
    bytes: Uint8Array.from([255, 255, 255]),
    width: 1,
    height: 1,
    components: 3,
    transform: { scaleX: 1, scaleY: 1, offsetX: 0, offsetY: 0 }
  };
}

describe("Centerline cached path refit", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reuses the original upload and nonce while targeting only the path-save output", async () => {
    vi.stubGlobal("window", globalThis);
    const responses = [
      new Response(JSON.stringify({
        name: "source.ppm",
        subfolder: "centerline_forge/run-123"
      }), { status: 200 }),
      new Response(JSON.stringify({ prompt_id: sourcePromptId, node_errors: {} }), { status: 200 }),
      new Response(JSON.stringify({
        [sourcePromptId]: {
          status: { completed: true },
          outputs: {
            "29": {
              images: [{
                filename: "centerline_pad20_refit_source_00001_.png",
                subfolder: "centerline_forge",
                type: "output"
              }]
            }
          }
        }
      }), { status: 200 }),
      new Response(JSON.stringify({
        format: "photoshop-path-json",
        canvas: { width: 100, height: 100 },
        paths: [{
          closed: true,
          points: [
            {
              anchor: [20, 20],
              leftDirection: [20, 20],
              rightDirection: [20, 20]
            },
            {
              anchor: [80, 80],
              leftDirection: [80, 80],
              rightDirection: [80, 80]
            }
          ]
        }]
      }), { status: 200 }),
      new Response(JSON.stringify({ prompt_id: refitPromptId, node_errors: {} }), { status: 200 })
    ];
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      responses.shift()!
    );
    vi.stubGlobal("fetch", fetchMock);

    const client = new CenterlineComfyClient("http://localhost:8188");
    const original = await client.createJob(pixelSource(), {
      detail: 100,
      cornerSensitivity: 80,
      smoothing: 100
    });
    await client.getResult(original.id);
    const refit = await client.createRefitJob(original.id, {
      detail: 64,
      cornerSensitivity: 55,
      smoothing: 72
    });

    expect(refit.id).toBe(refitPromptId);
    expect(fetchMock).toHaveBeenCalledTimes(5);
    const originalRequest = JSON.parse(
      String((fetchMock.mock.calls[1]?.[1] as RequestInit).body)
    );
    const refitRequest = JSON.parse(
      String((fetchMock.mock.calls[4]?.[1] as RequestInit).body)
    );

    expect(originalRequest).not.toHaveProperty("partial_execution_targets");
    expect(refitRequest.partial_execution_targets).toEqual(["4"]);
    expect(Object.keys(refitRequest.prompt)).toEqual(["2", "4", "29"]);
    expect(refitRequest.prompt).not.toHaveProperty("11");
    expect(refitRequest.prompt["29"]).toMatchObject({
      class_type: "LoadImageOutput",
      inputs: {
        image: "centerline_forge/centerline_pad20_refit_source_00001_.png [output]"
      }
    });
    expect(refitRequest.prompt["2"].inputs).toMatchObject({
      detail: 64,
      corner_sensitivity: 55,
      smoothing: 72
    });
  });

  it("refuses a refit when the session no longer has the original cache context", async () => {
    const client = new CenterlineComfyClient("http://localhost:8188");

    await expect(client.createRefitJob(sourcePromptId, {
      detail: 50,
      cornerSensitivity: 50,
      smoothing: 50
    })).rejects.toThrow("缺少可复用的 ComfyUI 重拟合上下文");
  });
});
