const MATRIX_MIN_WIDTH = 350;
const MATRIX_FIXED_WIDTH = 183;
const CANDIDATE_SLOT_STEP = 71;

export function aiCandidateMatrixWidth(candidateCount: number): number {
  const normalizedCount = Number.isFinite(candidateCount)
    ? Math.max(1, Math.round(candidateCount))
    : 1;
  return Math.max(MATRIX_MIN_WIDTH, MATRIX_FIXED_WIDTH + normalizedCount * CANDIDATE_SLOT_STEP);
}

export function shouldForwardMatrixWheel(
  deltaX: number,
  deltaY: number,
  shiftKey: boolean
): boolean {
  return !shiftKey && deltaY !== 0 && Math.abs(deltaY) > Math.abs(deltaX);
}

export function clampAiMatrixScrollLeft(
  scrollLeft: number,
  contentWidth: number,
  viewportWidth: number
): number {
  const normalizedScrollLeft = Number.isFinite(scrollLeft) ? Math.max(0, scrollLeft) : 0;
  const normalizedContentWidth = Number.isFinite(contentWidth) ? Math.max(0, contentWidth) : 0;
  const normalizedViewportWidth = Number.isFinite(viewportWidth) ? Math.max(0, viewportWidth) : 0;
  return Math.min(
    normalizedScrollLeft,
    Math.max(0, normalizedContentWidth - normalizedViewportWidth)
  );
}
