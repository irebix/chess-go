import type { AssetCandidate } from "./models";

export type AiCandidateStatus =
  | "idle"
  | "queued"
  | "generating"
  | "ready"
  | "accepted"
  | "failed";

export interface AiCandidatePreview {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
}

export interface AiGeneratedImage {
  filename: string;
  subfolder: string;
  type: string;
  url: string;
  promptText?: string;
  preview?: AiCandidatePreview;
  previewError?: string;
}

export interface AiCandidateSlot {
  id: string;
  label: string;
  status: AiCandidateStatus;
  image?: AiGeneratedImage;
  error?: string;
}

export interface AiItemState {
  itemKey: string;
  candidates: AiCandidateSlot[];
}

export interface AiCandidateStats {
  total: number;
  completed: number;
  generating: number;
  queued: number;
  failed: number;
  accepted: number;
}

export type AiCandidateAction = "backfill" | "generate" | null;

export function reconcileAiItemStates(
  current: Record<string, AiItemState>,
  items: AssetCandidate[],
  candidateCount: number
): Record<string, AiItemState> {
  const count = normalizeCandidateCount(candidateCount);
  const next: Record<string, AiItemState> = { ...current };
  for (const item of items) {
    const previous = current[item.key];
    const preservedCount = previous?.candidates.reduce(
      (lastUsedIndex, candidate, index) => candidate.status === "idle" ? lastUsedIndex : index + 1,
      0
    ) ?? 0;
    const slotCount = Math.max(count, preservedCount);
    next[item.key] = {
      itemKey: item.key,
      candidates: Array.from({ length: slotCount }, (_, index) => {
        const existing = previous?.candidates[index];
        return existing ?? {
          id: `${item.key}:${index}`,
          label: aiCandidateSlotLabel(index),
          status: "idle" as const
        };
      })
    };
  }
  return next;
}

export function appendAiCandidateSlots(
  item: AiItemState,
  candidateCount: number
): AiItemState {
  const count = normalizeCandidateCount(candidateCount);
  const startIndex = item.candidates.length;
  return {
    ...item,
    candidates: [
      ...item.candidates,
      ...Array.from({ length: count }, (_, offset) => {
        const index = startIndex + offset;
        return {
          id: `${item.itemKey}:${index}`,
          label: aiCandidateSlotLabel(index),
          status: "queued" as const
        };
      })
    ]
  };
}

export function acceptAiCandidate(
  item: AiItemState,
  candidateId: string
): AiItemState {
  return {
    ...item,
    candidates: item.candidates.map((candidate) => {
      if (candidate.id === candidateId && candidate.image) {
        return { ...candidate, status: "accepted", error: undefined };
      }
      if (candidate.status === "accepted") return { ...candidate, status: "ready" };
      return candidate;
    })
  };
}

export function summarizeAiCandidates(states: AiItemState[]): AiCandidateStats {
  const candidates = states.flatMap((state) => state.candidates);
  return {
    total: candidates.length,
    completed: candidates.filter((candidate) => candidate.status === "ready" || candidate.status === "accepted").length,
    generating: candidates.filter((candidate) => candidate.status === "generating").length,
    queued: candidates.filter((candidate) => candidate.status === "queued").length,
    failed: candidates.filter((candidate) => candidate.status === "failed").length,
    accepted: candidates.filter((candidate) => candidate.status === "accepted").length
  };
}

export function aiCandidateAction(candidate: AiCandidateSlot): AiCandidateAction {
  if (candidate.image && (candidate.status === "ready" || candidate.status === "accepted")) {
    return "backfill";
  }
  if (candidate.status === "idle" || candidate.status === "failed") return "generate";
  return null;
}

export function isAiCandidateActionDisabled(
  candidate: AiCandidateSlot,
  generationDisabled: boolean,
  backfillDisabled: boolean
): boolean {
  const action = aiCandidateAction(candidate);
  if (action === "backfill") return backfillDisabled;
  if (action === "generate") return generationDisabled;
  return true;
}

export function normalizeCandidateCount(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(4, Math.max(1, Math.round(value)));
}

export function aiCandidateSlotLabel(index: number): string {
  let value = Math.max(0, Math.floor(index)) + 1;
  let label = "";
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + (value % 26)) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

export function selectedAiReferenceImage(item: AssetCandidate) {
  return item.imageCandidates.find((candidate) => candidate.id === item.selectedImageId);
}
