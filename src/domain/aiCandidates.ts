import type { AssetCandidate } from "./models";

export type AiCandidateStatus =
  | "idle"
  | "queued"
  | "generating"
  | "ready"
  | "accepted"
  | "failed";

export interface AiGeneratedImage {
  filename: string;
  subfolder: string;
  type: string;
  url: string;
  previewDataUrl?: string;
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

const SLOT_LABELS = ["A", "B", "C", "D"] as const;

export function reconcileAiItemStates(
  current: Record<string, AiItemState>,
  items: AssetCandidate[],
  candidateCount: number
): Record<string, AiItemState> {
  const count = normalizeCandidateCount(candidateCount);
  const next: Record<string, AiItemState> = { ...current };
  for (const item of items) {
    const previous = current[item.key];
    next[item.key] = {
      itemKey: item.key,
      candidates: Array.from({ length: count }, (_, index) => {
        const existing = previous?.candidates[index];
        return existing ?? {
          id: `${item.key}:${index}`,
          label: SLOT_LABELS[index]!,
          status: "idle" as const
        };
      })
    };
  }
  return next;
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

export function normalizeCandidateCount(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(4, Math.max(1, Math.round(value)));
}
