import type { AssetCandidate } from "./models";

export type AiCandidateStatus =
  | "idle"
  | "queued"
  | "generating"
  | "ready"
  | "accepted"
  | "failed"
  | "unknown";

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
  retryPromptText?: string;
  submissionPromptId?: string;
  submissionKey?: string;
}

export interface AiCandidateGenerationBatch {
  slotIndexes: number[];
  promptText?: string;
}

export interface AiPendingSubmissionSnapshot {
  slotCount: number;
  submissionKey: string;
  promptId?: string;
  promptText?: string;
  outcome?: "pending" | "output";
  images?: AiGeneratedImage[];
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
  unknown: number;
  accepted: number;
}

export interface RemovedAiCandidateImage {
  candidateId: string;
  image: AiGeneratedImage;
  submissionKey?: string;
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
  candidateCount: number,
  retryPromptText?: string
): AiItemState {
  const count = normalizeCandidateCount(candidateCount);
  const startIndex = item.candidates.length;
  const normalizedPromptText = retryPromptText?.trim() || undefined;
  return {
    ...item,
    candidates: [
      ...item.candidates,
      ...Array.from({ length: count }, (_, offset) => {
        const index = startIndex + offset;
        return {
          id: `${item.itemKey}:${index}`,
          label: aiCandidateSlotLabel(index),
          status: "queued" as const,
          ...(normalizedPromptText ? { retryPromptText: normalizedPromptText } : {})
        };
      })
    ]
  };
}

export function restoreAiPendingSubmission(
  item: AiItemState,
  pending: AiPendingSubmissionSnapshot
): AiItemState {
  const sameSubmission = (candidate: AiCandidateSlot): boolean => (
    candidate.submissionKey === pending.submissionKey
      || Boolean(pending.promptId && candidate.submissionPromptId === pending.promptId)
  );

  if (pending.outcome === "output") {
    const existingImageKeys = new Set(item.candidates.flatMap((candidate) => (
      sameSubmission(candidate) && candidate.image ? [aiGeneratedImageKey(candidate.image)] : []
    )));
    const missingImages = (pending.images ?? []).filter(
      (image) => !existingImageKeys.has(aiGeneratedImageKey(image))
    );
    if (!missingImages.length) return item;

    const candidates = item.candidates.map((candidate) => ({ ...candidate }));
    const targetIndexes = availableCandidateIndexes(candidates);
    while (targetIndexes.length < missingImages.length) {
      targetIndexes.push(appendIdleCandidate(candidates, item.itemKey));
    }
    const normalizedPromptText = pending.promptText?.trim() || undefined;
    missingImages.forEach((image, offset) => {
      const index = targetIndexes[offset]!;
      candidates[index] = {
        ...candidates[index]!,
        status: "ready",
        image,
        error: undefined,
        submissionKey: pending.submissionKey,
        ...(pending.promptId ? { submissionPromptId: pending.promptId } : {}),
        retryPromptText: image.promptText?.trim()
          || normalizedPromptText
          || candidates[index]!.retryPromptText
      };
    });
    return { ...item, candidates };
  }

  const slotCount = normalizeCandidateCount(pending.slotCount);
  const candidates = item.candidates.map((candidate) => ({ ...candidate }));
  const existingCount = candidates.filter(sameSubmission).length;
  const missingSlotCount = Math.max(0, slotCount - existingCount);
  if (!missingSlotCount) return item;
  const targetIndexes = availableCandidateIndexes(candidates);
  while (targetIndexes.length < missingSlotCount) {
    targetIndexes.push(appendIdleCandidate(candidates, item.itemKey));
  }
  const normalizedPromptText = pending.promptText?.trim() || undefined;
  for (const index of targetIndexes.slice(0, missingSlotCount)) {
    candidates[index] = {
      ...candidates[index]!,
      status: "unknown",
      error: "Holopix 提交结果尚未确认；请先恢复已有候选，确认放弃前不会直接重试。",
      submissionKey: pending.submissionKey,
      ...(pending.promptId ? { submissionPromptId: pending.promptId } : {}),
      ...(normalizedPromptText ? { retryPromptText: normalizedPromptText } : {})
    };
  }
  return { ...item, candidates };
}

export function abandonAiCandidateUnknowns(
  item: AiItemState
): { item: AiItemState; abandonedCount: number; submissionKeys: string[] } {
  const submissionKeys = new Set<string>();
  let abandonedCount = 0;
  const candidates = item.candidates.map((candidate) => {
    if (candidate.status !== "unknown") return candidate;
    abandonedCount += 1;
    if (candidate.submissionKey) submissionKeys.add(candidate.submissionKey);
    return {
      ...candidate,
      status: "failed" as const,
      error: "已由用户确认放弃待确认状态；再次生成可能产生新的付费任务。",
      submissionPromptId: undefined,
      submissionKey: undefined
    };
  });
  return {
    item: { ...item, candidates },
    abandonedCount,
    submissionKeys: Array.from(submissionKeys)
  };
}

export function buildAiCandidateGenerationBatches(
  candidates: AiCandidateSlot[],
  maxBatchSize = 4
): AiCandidateGenerationBatch[] {
  const normalizedBatchSize = Math.max(1, Math.floor(maxBatchSize));
  const groups = new Map<string, { promptText?: string; slotIndexes: number[] }>();
  candidates.forEach((candidate, index) => {
    if (candidate.status !== "idle" && candidate.status !== "failed") return;
    const promptText = candidate.retryPromptText?.trim() || undefined;
    const key = promptText ?? "";
    const group = groups.get(key) ?? { promptText, slotIndexes: [] };
    group.slotIndexes.push(index);
    groups.set(key, group);
  });

  return Array.from(groups.values()).flatMap((group) => {
    const batches: AiCandidateGenerationBatch[] = [];
    for (let index = 0; index < group.slotIndexes.length; index += normalizedBatchSize) {
      batches.push({
        slotIndexes: group.slotIndexes.slice(index, index + normalizedBatchSize),
        ...(group.promptText ? { promptText: group.promptText } : {})
      });
    }
    return batches;
  });
}

export function applyAiGeneratedCandidateBatch(
  item: AiItemState,
  jobSlotIndexes: number[],
  completedBeforeBatch: number,
  images: AiGeneratedImage[],
  resolvedPromptText?: string,
  submission?: { promptId?: string; key?: string }
): AiItemState {
  const imageBySlotIndex = new Map<number, AiGeneratedImage>();
  images.forEach((image, offset) => {
    const slotIndex = jobSlotIndexes[completedBeforeBatch + offset];
    if (slotIndex !== undefined) imageBySlotIndex.set(slotIndex, image);
  });
  const normalizedPromptText = resolvedPromptText?.trim() || undefined;
  return {
    ...item,
    candidates: item.candidates.map((candidate, index) => {
      const image = imageBySlotIndex.get(index);
      if (!image) return candidate;
      return {
        ...candidate,
        status: candidate.status === "accepted" ? "accepted" : "ready",
        image,
        error: undefined,
        retryPromptText: image.promptText?.trim() || normalizedPromptText || candidate.retryPromptText,
        submissionPromptId: submission?.promptId ?? candidate.submissionPromptId,
        submissionKey: submission?.key ?? candidate.submissionKey
      };
    })
  };
}

export function failAiCandidateGenerationRemainder(
  item: AiItemState,
  jobSlotIndexes: number[],
  completedCandidates: number,
  error: string,
  resolvedPromptText?: string
): AiItemState {
  const failedIndexes = new Set(jobSlotIndexes.slice(completedCandidates));
  const normalizedPromptText = resolvedPromptText?.trim() || undefined;
  return {
    ...item,
    candidates: item.candidates.map((candidate, index) => failedIndexes.has(index)
      ? {
          ...candidate,
          status: "failed",
          error,
          retryPromptText: normalizedPromptText ?? candidate.retryPromptText
        }
      : candidate)
  };
}

export function markAiCandidateGenerationUnknown(
  item: AiItemState,
  jobSlotIndexes: number[],
  completedCandidates: number,
  error: string,
  submission: { promptId?: string; key?: string },
  resolvedPromptText?: string
): AiItemState {
  const unknownIndexes = new Set(jobSlotIndexes.slice(completedCandidates));
  const normalizedPromptText = resolvedPromptText?.trim() || undefined;
  return {
    ...item,
    candidates: item.candidates.map((candidate, index) => unknownIndexes.has(index)
      ? {
          ...candidate,
          status: "unknown",
          error,
          retryPromptText: normalizedPromptText ?? candidate.retryPromptText,
          ...(submission.promptId ? { submissionPromptId: submission.promptId } : {}),
          ...(submission.key ? { submissionKey: submission.key } : {})
        }
      : candidate)
  };
}

export function mergeRecoveredAiCandidateImages(
  item: AiItemState,
  images: AiGeneratedImage[],
  options: { promptId?: string } = {}
): { item: AiItemState; recoveredCount: number } {
  const recoveredByKey = new Map(
    images.map((image) => [aiGeneratedImageKey(image), image])
  );
  const enhancedByIndex = new Map<number, AiGeneratedImage>();
  item.candidates.forEach((candidate, index) => {
    if (!candidate.image?.preview) {
      const recovered = candidate.image
        ? recoveredByKey.get(aiGeneratedImageKey(candidate.image))
        : undefined;
      if (recovered?.preview) enhancedByIndex.set(index, recovered);
    }
  });
  const existingImageKeys = new Set(
    item.candidates.flatMap((candidate) => candidate.image
      ? [aiGeneratedImageKey(candidate.image)]
      : [])
  );
  const available = images.filter((image) => !existingImageKeys.has(aiGeneratedImageKey(image)));
  const targetIndexes = options.promptId
    ? item.candidates.flatMap((candidate, index) => (
        candidate.status === "unknown" && candidate.submissionPromptId === options.promptId
          ? [index]
          : []
      ))
    : item.candidates.flatMap((candidate, index) => (
        candidate.status !== "unknown" && !candidate.image ? [index] : []
      ));
  const imageByIndex = new Map<number, AiGeneratedImage>();
  available.slice(0, targetIndexes.length).forEach((image, index) => {
    imageByIndex.set(targetIndexes[index]!, image);
  });
  return {
    item: {
      ...item,
      candidates: item.candidates.map((candidate, index) => {
        const image = imageByIndex.get(index);
        const enhanced = enhancedByIndex.get(index);
        if (!image && enhanced) {
          return {
            ...candidate,
            image: {
              ...candidate.image,
              ...enhanced,
              promptText: enhanced.promptText ?? candidate.image?.promptText
            },
            error: undefined
          };
        }
        if (!image) return candidate;
        return {
          ...candidate,
          status: candidate.status === "accepted" ? "accepted" : "ready",
          image,
          error: undefined,
          submissionPromptId: options.promptId ? candidate.submissionPromptId : undefined,
          submissionKey: options.promptId ? candidate.submissionKey : undefined
        };
      })
    },
    recoveredCount: imageByIndex.size + enhancedByIndex.size
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

export function isAiCandidateDeletable(candidate: AiCandidateSlot): boolean {
  return Boolean(
    candidate.image
    && (candidate.status === "ready" || candidate.status === "accepted")
  );
}

export function removeAiCandidateImages(
  item: AiItemState,
  candidateIds: Iterable<string>,
  minimumSlotCount: number
): { item: AiItemState; removed: RemovedAiCandidateImage[] } {
  const ids = new Set(candidateIds);
  const removed: RemovedAiCandidateImage[] = [];
  const candidates = item.candidates.map((candidate) => {
    if (!ids.has(candidate.id) || !isAiCandidateDeletable(candidate) || !candidate.image) {
      return candidate;
    }
    removed.push({
      candidateId: candidate.id,
      image: candidate.image,
      ...(candidate.submissionKey ? { submissionKey: candidate.submissionKey } : {})
    });
    const retryPromptText = candidate.retryPromptText?.trim()
      || candidate.image.promptText?.trim()
      || undefined;
    return {
      id: candidate.id,
      label: candidate.label,
      status: "idle" as const,
      ...(retryPromptText ? { retryPromptText } : {})
    };
  });
  const minimum = normalizeCandidateCount(minimumSlotCount);
  while (candidates.length > minimum) {
    const tail = candidates[candidates.length - 1]!;
    if (tail.status !== "idle" || tail.image) break;
    candidates.pop();
  }
  return {
    item: { ...item, candidates },
    removed
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
    unknown: candidates.filter((candidate) => candidate.status === "unknown").length,
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

function aiGeneratedImageKey(image: AiGeneratedImage): string {
  return `${image.type}:${image.subfolder}:${image.filename}`;
}

function availableCandidateIndexes(candidates: AiCandidateSlot[]): number[] {
  return candidates.flatMap((candidate, index) => (
    !candidate.image && (candidate.status === "idle" || candidate.status === "failed")
      ? [index]
      : []
  ));
}

function appendIdleCandidate(candidates: AiCandidateSlot[], itemKey: string): number {
  const index = candidates.length;
  candidates.push({
    id: `${itemKey}:${index}`,
    label: aiCandidateSlotLabel(index),
    status: "idle"
  });
  return index;
}
