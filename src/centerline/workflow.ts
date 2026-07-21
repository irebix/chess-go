import type { CenterlineVectorSettings } from "./types";
import {
  CENTERLINE_OUTPUT_BASENAME,
  CENTERLINE_WORKFLOW_PADDING_PX
} from "./config";

export interface CenterlineWorkflowNode {
  inputs: Record<string, unknown>;
  class_type: string;
  _meta: { title: string };
}

export type CenterlineWorkflow = Record<string, CenterlineWorkflowNode>;

export function createAutomaticOutlineWorkflow(): CenterlineWorkflow {
  return {
    "2": {
      inputs: {
        detail: 100,
        corner_sensitivity: 80,
        smoothing: 100,
        preview_line_width: 6,
        min_path_length: 100,
        max_anchors: 100,
        invert: "auto",
        batch_index: 0,
        image: ["18", 0]
      },
      class_type: "CenterlineForgeVectorize",
      _meta: { title: "⑧ 精确描边矢量化" }
    },
    "3": {
      inputs: { images: ["2", 0] },
      class_type: "PreviewImage",
      _meta: { title: "矢量结果" }
    },
    "4": {
      inputs: {
        filename_prefix: `centerline_forge/${CENTERLINE_OUTPUT_BASENAME}`,
        overwrite: true,
        svg: ["2", 2],
        path_json: ["2", 3]
      },
      class_type: "CenterlineForgeSave",
      _meta: { title: "保存 SVG + Path JSON" }
    },
    "6": {
      inputs: { images: ["2", 1] },
      class_type: "PreviewImage",
      _meta: { title: "矢量锚点调试" }
    },
    "7": {
      inputs: { image: "pasted/image (3).png" },
      class_type: "LoadImage",
      _meta: { title: "① 原始彩色图（几何基准）" }
    },
    "9": {
      inputs: { images: ["11", 0] },
      class_type: "PreviewImage",
      _meta: { title: "Holopix 原始描边（对照）" }
    },
    "11": {
      inputs: {
        aspect_ratio: "1:1",
        batch_size: "1",
        request_nonce: 365901467480228,
        confirm_cost: true,
        timeout_seconds: 150,
        prompt: ["12", 0],
        images: ["24", 0]
      },
      class_type: "HolopixGenerateV3",
      _meta: { title: "③ Holopix 全能编辑 V3（2K）" }
    },
    "12": {
      inputs: {
        value: "以参考图为唯一的形状依据，执行“物体剪影外轮廓提取”，不要重新绘制物体，也不要生成普通线稿。\n\n先将参考图中的所有物件全部视为同一个完整物体，仅提取这个完整物体与白色背景接触的最外侧剪影边界。\n\n输出要求：\n1. 画面中只允许出现一条连续、闭合、平滑的黑色外轮廓线。\n2. 只绘制整个物体的最外部剪影边界，内部区域完全留白。\n3. 保持参考图的整体外形、比例、朝向和轮廓凹凸关系。\n4. 黑色描边，视觉线宽完全统一，圆角端点，平滑的 SVG 矢量路径风格。\n5. 白色物体填充，纯白色背景，1:1 构图，物体居中。\n\n只输出整个物体剪影最外侧的一条闭合边界线。"
      },
      class_type: "PrimitiveStringMultiline",
      _meta: { title: "② Holopix 提示词（仅作生成对照）" }
    },
    "13": {
      inputs: {
        model: "BiRefNet_toonout",
        mask_blur: 0,
        mask_offset: 0,
        invert_output: false,
        refine_foreground: false,
        background: "Alpha",
        background_color: "#222222",
        image: ["7", 0]
      },
      class_type: "BiRefNetRMBG",
      _meta: { title: "④ 本地精确主体蒙版（toonout）" }
    },
    "14": {
      inputs: {
        expand: 3,
        tapered_corners: true,
        mask: ["24", 1]
      },
      class_type: "GrowMask",
      _meta: { title: "外扩 +3 px" }
    },
    "15": {
      inputs: {
        expand: -3,
        tapered_corners: true,
        mask: ["24", 1]
      },
      class_type: "GrowMask",
      _meta: { title: "内缩 -3 px" }
    },
    "16": {
      inputs: {
        x: 0,
        y: 0,
        operation: "subtract",
        destination: ["14", 0],
        source: ["15", 0]
      },
      class_type: "MaskComposite",
      _meta: { title: "⑤ 精确边界 = 外扩 − 内缩" }
    },
    "17": {
      inputs: { mask: ["16", 0] },
      class_type: "InvertMask",
      _meta: { title: "黑白反转" }
    },
    "18": {
      inputs: { mask: ["17", 0] },
      class_type: "MaskToImage",
      _meta: { title: "⑥ 最终精确描边（620×620）" }
    },
    "19": {
      inputs: {
        mask_opacity: 0.85,
        mask_color: "#FF0066",
        image: ["24", 0],
        mask: ["16", 0]
      },
      class_type: "AILab_MaskOverlay",
      _meta: { title: "粉色边缘叠加原图（贴合检查）" }
    },
    "20": {
      inputs: {
        text1: "原始彩色图",
        text2: "Holopix 描边",
        text3: "精确校正描边",
        size_base: "image1",
        text_color: "#111111",
        bg_color: "#FFFFFF",
        image1: ["24", 0],
        image2: ["11", 0],
        image3: ["18", 0]
      },
      class_type: "AILab_ImageCompare",
      _meta: { title: "⑦ 三图并排：原图 / Holopix / 精确" }
    },
    "21": {
      inputs: { images: ["20", 0] },
      class_type: "PreviewImage",
      _meta: { title: "三图对比预览" }
    },
    "22": {
      inputs: { images: ["19", 0] },
      class_type: "PreviewImage",
      _meta: { title: "逐像素贴合预览" }
    },
    "23": {
      inputs: {
        mode: "main_color",
        color_of: "background",
        remove_bkgd_method: "none",
        invert_mask: false,
        mask_grow: 0,
        image: ["7", 0],
        mask: ["13", 1]
      },
      class_type: "LayerUtility: GetColorToneV2",
      _meta: { title: "提取原图背景主色" }
    },
    "24": {
      inputs: {
        invert_mask: false,
        top: CENTERLINE_WORKFLOW_PADDING_PX,
        bottom: CENTERLINE_WORKFLOW_PADDING_PX,
        left: CENTERLINE_WORKFLOW_PADDING_PX,
        right: CENTERLINE_WORKFLOW_PADDING_PX,
        image: ["7", 0],
        mask: ["13", 1],
        color: ["23", 1]
      },
      class_type: "LayerUtility: ExtendCanvasV2",
      _meta: { title: "四周扩展 20 px（匹配背景色）" }
    }
  };
}

export function makeAutomaticOutlinePrompt(
  uploadedImageName: string,
  settings: CenterlineVectorSettings
): CenterlineWorkflow {
  const prompt = createAutomaticOutlineWorkflow();
  prompt["7"]!.inputs.image = uploadedImageName;
  prompt["2"]!.inputs.detail = clampPercent(settings.detail);
  prompt["2"]!.inputs.corner_sensitivity = clampPercent(settings.cornerSensitivity);
  prompt["2"]!.inputs.smoothing = clampPercent(settings.smoothing);
  return prompt;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
}
