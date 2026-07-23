import {
  documentCanvasSize,
  documentHasArtboards,
  isExactStandardGridCanvasSize,
  readGridMetadataStore,
  type GridMetadataDocumentLike,
  type GridMetadataStoreState
} from "../grid/GridMetadataStore";

export type PlacementMode = "ARTBOARD" | "STANDARD_GRID" | "UNSUPPORTED_CANVAS";

export interface GridCanvasInspection {
  documentId: number;
  mode: PlacementMode;
  metadata: GridMetadataStoreState;
  canvas: { width: number; height: number };
  canInitialize: boolean;
  message?: string;
}

export function resolvePlacementMode(documentValue: unknown): PlacementMode {
  const document = documentValue as GridMetadataDocumentLike;
  if (documentHasArtboards(document)) return "ARTBOARD";
  return readGridMetadataStore(document).status === "valid"
    ? "STANDARD_GRID"
    : "UNSUPPORTED_CANVAS";
}

export function inspectGridCanvas(documentValue: unknown): GridCanvasInspection {
  const document = documentValue as GridMetadataDocumentLike;
  const canvas = documentCanvasSize(document);
  if (documentHasArtboards(document)) {
    return {
      documentId: document.id,
      mode: "ARTBOARD",
      metadata: { status: "missing" },
      canvas,
      canInitialize: false
    };
  }
  const metadata = readGridMetadataStore(document);
  if (metadata.status === "valid") {
    return {
      documentId: document.id,
      mode: "STANDARD_GRID",
      metadata,
      canvas,
      canInitialize: false
    };
  }
  if (metadata.status === "unsupported-version") {
    return {
      documentId: document.id,
      mode: "UNSUPPORTED_CANVAS",
      metadata,
      canvas,
      canInitialize: false,
      message: `当前 PSD 使用网格数据 v${metadata.version}，请升级棋子go。`
    };
  }
  if (metadata.status === "invalid") {
    return {
      documentId: document.id,
      mode: "UNSUPPORTED_CANVAS",
      metadata,
      canvas,
      canInitialize: isExactStandardGridCanvasSize(document),
      message: metadata.reason
    };
  }
  const canInitialize = isExactStandardGridCanvasSize(document);
  return {
    documentId: document.id,
    mode: "UNSUPPORTED_CANVAS",
    metadata,
    canvas,
    canInitialize,
    message: canInitialize
      ? "检测到标准尺寸画布，尚未初始化为棋子go标准网格。"
      : "当前不是棋子go标准网格画布，无法自动定位。AI 结果已保留。"
  };
}
