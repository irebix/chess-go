import type { CenterlineLayerIdentity } from "./types";

export function isReadyResultAvailableForActiveDocument(
  source: CenterlineLayerIdentity,
  activeDocumentId: number | null,
  sourceAvailable: boolean
): boolean {
  return sourceAvailable
    && activeDocumentId !== null
    && source.documentId === activeDocumentId;
}

export function shouldReportStoredOutlineAsReady(
  readySource: CenterlineLayerIdentity | null
): boolean {
  return readySource !== null;
}
