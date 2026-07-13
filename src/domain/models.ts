export interface SourceFileInfo {
  fileName: string;
  fileSize?: number;
  modifiedAt?: string;
}

export interface SheetDescriptor {
  name: string;
  sheetId: string;
  relationshipId: string;
  xmlEntry: string;
  state: "visible" | "hidden" | "veryHidden";
  order: number;
}

export interface WorkbookIndex {
  source: SourceFileInfo;
  sheets: SheetDescriptor[];
  sharedStringsEntry?: string;
}

export type CellScalar = string | boolean | null;

export interface CellRecord {
  address: string;
  row: number;
  col: number;
  value: CellScalar;
  rawType?: string;
}

export interface MergedCellRange {
  ref: string;
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}

export interface ImageAnchor {
  id: string;
  anchorType: "oneCell" | "twoCell";
  fromRow: number;
  fromCol: number;
  toRow?: number;
  toCol?: number;
  relationshipId: string;
  archiveEntry: string;
  mediaType: "png" | "jpeg" | "other";
  widthEmu?: number;
  heightEmu?: number;
}

export interface ImageCandidate {
  id: string;
  anchor: ImageAnchor;
  relativeRowOffset: number;
  relativeColOffset: number;
  thumbnailState: "notLoaded" | "loading" | "ready" | "error";
}

export interface ValidationIssue {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  itemKey?: string;
  sourceCell?: string;
  details?: Record<string, unknown>;
}

export interface AssetCandidate {
  key: string;
  assetCode: string;
  numericId?: string;
  name?: string;
  prefix: string;
  sheetName: string;
  codeCell: string;
  codeRow: number;
  codeCol: number;
  nameCell?: string;
  numericIdCell?: string;
  sourceGroupId: string;
  sourceOrder: number;
  imageCandidates: ImageCandidate[];
  selectedImageId?: string;
  issues: ValidationIssue[];
  selected: boolean;
}

export interface ParsedSheet {
  descriptor: SheetDescriptor;
  cells: CellRecord[];
  images: ImageAnchor[];
  mergedCells: MergedCellRange[];
}

export interface SheetGroupSegment {
  ref: string;
  startRow: number;
  endRow: number;
}

export interface SheetGroup {
  id: string;
  label: string;
  sourceCell: string;
  startRow: number;
  endRow: number;
  itemCount: number;
  physicalSegments: SheetGroupSegment[];
  inferredContinuation: boolean;
}

export interface GenerationItem {
  assetCode: string;
  numericId?: string;
  name?: string;
  sheetName: string;
  codeCell: string;
  nameCell?: string;
  numericIdCell?: string;
  sourceGroupId: string;
  sourceOrder: number;
  imageEntry: string;
  imageAnchorCell: string;
}

export interface GenerationJob {
  schemaVersion: "1.0";
  source: SourceFileInfo & {
    sheetName: string;
    selectedGroups?: SheetGroup[];
  };
  template: PsdTemplate;
  items: GenerationItem[];
  output: {
    folderToken?: string;
    baseName: string;
    preferPsb: boolean;
  };
}

export interface PsdTemplate {
  schemaVersion: "1.0";
  id: string;
  name: string;
  artboard: {
    width: number;
    height: number;
    columns: number;
    gapX: number;
    gapY: number;
    background: "white" | "transparent";
  };
  document: {
    resolution: number;
    colorMode: "RGB";
    bitsPerChannel: 8;
  };
  placement: {
    maxVisibleWidth: number;
    maxVisibleHeight: number;
    targetCenterX: number;
    targetCenterY: number;
    allowUpscale: boolean;
    interpolation: "bicubicAutomatic" | "bicubicSharper";
  };
  layout: {
    preserveSourceGroups: boolean;
    maxArtboardsPerDocument: number;
  };
}

export const DEFAULT_TEMPLATE: PsdTemplate = {
  schemaVersion: "1.0",
  id: "archive-148",
  name: "归档 148",
  artboard: {
    width: 148,
    height: 148,
    columns: 10,
    gapX: 100,
    gapY: 100,
    background: "white"
  },
  document: {
    resolution: 300,
    colorMode: "RGB",
    bitsPerChannel: 8
  },
  placement: {
    maxVisibleWidth: 146,
    maxVisibleHeight: 134,
    targetCenterX: 74,
    targetCenterY: 78,
    allowUpscale: false,
    interpolation: "bicubicAutomatic"
  },
  layout: {
    preserveSourceGroups: true,
    maxArtboardsPerDocument: 100
  }
};
