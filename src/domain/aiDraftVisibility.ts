import type { PlacementMode } from "../photoshop/placementMode";

export function shouldShowAiDraftPanel(
  activeDocumentId: number | null,
  placementMode: PlacementMode
): boolean {
  return activeDocumentId !== null
    && (placementMode === "ARTBOARD" || placementMode === "STANDARD_GRID");
}
