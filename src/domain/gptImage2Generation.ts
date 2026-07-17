import type { AiCandidateSlot, AiItemState } from "./aiCandidates";

export interface GptImage2GenerationRound<TItem> {
  slotIndex: number;
  entries: Array<{
    item: TItem;
    promptText?: string;
  }>;
}

export function buildGptImage2GenerationRounds<TItem extends { key: string }>(
  items: TItem[],
  states: Record<string, AiItemState>
): GptImage2GenerationRound<TItem>[] {
  const rounds = new Map<number, GptImage2GenerationRound<TItem>["entries"]>();
  for (const item of items) {
    const state = states[item.key];
    if (!state) continue;
    state.candidates.forEach((candidate, slotIndex) => {
      if (!isGeneratable(candidate)) return;
      const entries = rounds.get(slotIndex) ?? [];
      const promptText = candidate.retryPromptText?.trim() || undefined;
      entries.push({ item, ...(promptText ? { promptText } : {}) });
      rounds.set(slotIndex, entries);
    });
  }
  return Array.from(rounds, ([slotIndex, entries]) => ({ slotIndex, entries }))
    .sort((left, right) => left.slotIndex - right.slotIndex);
}

function isGeneratable(candidate: AiCandidateSlot): boolean {
  return candidate.status === "idle" || candidate.status === "failed";
}
