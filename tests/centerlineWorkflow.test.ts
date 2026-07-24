import { describe, expect, it } from "vitest";
import {
  createAutomaticOutlineWorkflow,
  makeAutomaticOutlinePrompt
} from "../src/centerline/workflow";
import { CENTERLINE_JOB_TIMEOUT_MS } from "../src/centerline/config";

describe("Centerline Forge workflow integration", () => {
  it("allows the complete ComfyUI job to run beyond 200 seconds", () => {
    expect(CENTERLINE_JOB_TIMEOUT_MS).toBe(360_000);
  });

  it("extends the automatic-outline workflow with background-matched 20 px padding", () => {
    const workflow = createAutomaticOutlineWorkflow();

    expect(Object.keys(workflow)).toEqual([
      "2", "3", "4", "6", "7", "9", "11", "12", "13",
      "14", "15", "16", "17", "18", "19", "20", "21", "22", "23", "24",
      "25", "26", "27", "28"
    ]);
    expect(workflow["2"]?.class_type).toBe("CenterlineForgeVectorize");
    expect(workflow["4"]?.class_type).toBe("CenterlineForgeSave");
    expect(workflow["11"]?.class_type).toBe("HolopixGenerateV3");
    expect(workflow["13"]?.inputs.model).toBe("BiRefNet_toonout");
    expect(workflow["20"]?.class_type).toBe("AILab_ImageCompare");
    expect(workflow["25"]).toMatchObject({
      class_type: "easy imageSizeBySide",
      inputs: { image: ["7", 0], side: "Shortest" }
    });
    expect(workflow["26"]).toMatchObject({
      class_type: "easy compare",
      inputs: { a: ["25", 0], b: 300, comparison: "a <= b" }
    });
    expect(workflow["27"]).toMatchObject({
      class_type: "LayerUtility: ImageScaleByAspectRatio V2",
      inputs: {
        aspect_ratio: "original",
        method: "lanczos",
        round_to_multiple: "None",
        scale_to_side: "shortest",
        scale_to_length: 300,
        image: ["7", 0]
      }
    });
    expect(workflow["28"]).toMatchObject({
      class_type: "easy ifElse",
      inputs: {
        boolean: ["26", 0],
        on_true: ["27", 0],
        on_false: ["7", 0]
      }
    });
    expect(workflow["23"]).toMatchObject({
      class_type: "LayerUtility: GetColorToneV2",
      inputs: {
        mode: "main_color",
        color_of: "background",
        image: ["28", 0],
        mask: ["13", 1]
      }
    });
    expect(workflow["24"]).toMatchObject({
      class_type: "LayerUtility: ExtendCanvasV2",
      inputs: {
        top: 20,
        bottom: 20,
        left: 20,
        right: 20,
        image: ["28", 0],
        mask: ["13", 1],
        color: ["23", 1]
      }
    });
    expect(workflow["11"]?.inputs.images).toEqual(["24", 0]);
    expect(workflow["14"]?.inputs.mask).toEqual(["24", 1]);
    expect(workflow["15"]?.inputs.mask).toEqual(["24", 1]);
    expect(workflow["13"]?.inputs.image).toEqual(["28", 0]);
  });

  it("changes the uploaded image, request nonce, and the three exposed vector controls", () => {
    const expected = createAutomaticOutlineWorkflow();
    expected["7"]!.inputs.image = "centerline_forge/current-layer.ppm";
    expected["11"]!.inputs.request_nonce = 1784614660068;
    expected["2"]!.inputs.detail = 72;
    expected["2"]!.inputs.corner_sensitivity = 64;
    expected["2"]!.inputs.smoothing = 91;

    expect(makeAutomaticOutlinePrompt("centerline_forge/current-layer.ppm", {
      detail: 72,
      cornerSensitivity: 64,
      smoothing: 91
    }, 1784614660068)).toEqual(expected);
  });

  it("keeps fixed Holopix and save parameters while clamping slider values", () => {
    const workflow = makeAutomaticOutlinePrompt("input.ppm", {
      detail: 120,
      cornerSensitivity: -8,
      smoothing: 50
    }, 1784614660069);

    expect(workflow["2"]?.inputs).toMatchObject({
      detail: 100,
      corner_sensitivity: 0,
      smoothing: 50,
      preview_line_width: 6,
      min_path_length: 100,
      max_anchors: 100
    });
    expect(workflow["11"]?.inputs).toMatchObject({
      aspect_ratio: "1:1",
      batch_size: "1",
      request_nonce: 1784614660069,
      vip_channel: true,
      timeout_seconds: 150
    });
    expect(workflow["11"]?.inputs).not.toHaveProperty("confirm_cost");
    expect(workflow["4"]?.inputs).toMatchObject({
      filename_prefix: "centerline_forge/centerline_pad20",
      overwrite: true
    });
  });

  it("uses a different Holopix nonce for each explicit generation request", () => {
    const settings = { detail: 100, cornerSensitivity: 80, smoothing: 100 };
    const first = makeAutomaticOutlinePrompt("run-one/input.ppm", settings, 101);
    const second = makeAutomaticOutlinePrompt("run-two/input.ppm", settings, 102);

    expect(first["7"]?.inputs.image).not.toBe(second["7"]?.inputs.image);
    expect(first["11"]?.inputs.request_nonce).toBe(101);
    expect(second["11"]?.inputs.request_nonce).toBe(102);
  });
});
