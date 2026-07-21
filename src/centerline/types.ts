export type CenterlineCoordinate = [number, number];

export interface CenterlinePathPoint {
  anchor: CenterlineCoordinate;
  leftDirection: CenterlineCoordinate;
  rightDirection: CenterlineCoordinate;
  kind?: "smooth" | "corner" | string;
}

export interface CenterlineSubpath {
  closed: boolean;
  points: CenterlinePathPoint[];
}

export interface CenterlinePathJson {
  format: "photoshop-path-json";
  canvas: {
    width: number;
    height: number;
  };
  paths: CenterlineSubpath[];
  report?: CenterlineReport;
  [key: string]: unknown;
}

export interface CenterlineReport {
  pathCount?: number;
  totalAnchors?: number;
  totalDetectedCorners?: number;
  resolvedFitErrorPx?: number;
  [key: string]: unknown;
}

export interface CenterlinePixelTransform {
  scaleX: number;
  scaleY: number;
  offsetX: number;
  offsetY: number;
}

export interface CenterlinePixelSource {
  documentId: number;
  documentName: string;
  layerId: number;
  layerName: string;
  bytes: Uint8Array;
  width: number;
  height: number;
  components: number;
  transform: CenterlinePixelTransform;
}

export type CenterlineJobStatus = "queued" | "running" | "completed" | "failed" | "canceled";

export interface CenterlineJob {
  id: string;
  status: CenterlineJobStatus;
  stage: string;
  progress: number;
  error?: string;
}

export interface CenterlineResult {
  pathJson: CenterlinePathJson;
  report: CenterlineReport;
  svgUrl: string;
}

export interface CenterlineVectorSettings {
  detail: number;
  cornerSensitivity: number;
  smoothing: number;
}
