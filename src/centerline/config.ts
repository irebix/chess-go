import { COMFY_BASE_URL } from "../ai/holopixEndpoint";

export const CENTERLINE_COMFY_BASE_URL = COMFY_BASE_URL;
export const CENTERLINE_POLL_INTERVAL_MS = 1200;
export const CENTERLINE_REQUEST_TIMEOUT_MS = 180_000;
export const CENTERLINE_JOB_TIMEOUT_MS = 360_000;
export const CENTERLINE_MAX_CLIENT_PATHS = 2000;
export const CENTERLINE_MAX_CLIENT_ANCHORS = 20_000;
export const CENTERLINE_MAX_UPLOAD_PIXELS = 64_000_000;
export const CENTERLINE_MIN_INPUT_SHORT_SIDE_PX = 300;
export const CENTERLINE_WORKFLOW_PADDING_PX = 20;
export const CENTERLINE_OUTPUT_BASENAME = "centerline_pad20";

export const CENTERLINE_REQUIRED_NODES = [
  "CenterlineForgeVectorize",
  "CenterlineForgeSave",
  "LoadImage",
  "PreviewImage",
  "HolopixGenerateV3",
  "PrimitiveStringMultiline",
  "BiRefNetRMBG",
  "GrowMask",
  "MaskComposite",
  "InvertMask",
  "MaskToImage",
  "AILab_MaskOverlay",
  "AILab_ImageCompare",
  "easy imageSizeBySide",
  "easy compare",
  "easy ifElse",
  "LayerUtility: ImageScaleByAspectRatio V2",
  "LayerUtility: GetColorToneV2",
  "LayerUtility: ExtendCanvasV2"
] as const;
