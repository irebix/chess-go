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
