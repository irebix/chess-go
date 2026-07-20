import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AssetCandidate, SheetGroup } from "../domain/models";
import {
  abandonAiCandidateUnknowns,
  acceptAiCandidate,
  aiCandidateAction,
  applyAiGeneratedCandidateBatch,
  appendAiCandidateSlots,
  buildAiCandidateGenerationBatches,
  failAiCandidateGenerationRemainder,
  isAiCandidateActionDisabled,
  markAiCandidateGenerationUnknown,
  mergeRecoveredAiCandidateImages,
  reconcileAiItemStates,
  restoreAiPendingSubmission,
  selectedAiReferenceImage,
  summarizeAiCandidates,
  type AiCandidatePreview,
  type AiCandidateSlot,
  type AiGeneratedImage,
  type AiItemState
} from "../domain/aiCandidates";
import {
  aiCandidateMatrixWidth,
  clampAiMatrixScrollLeft,
  shouldForwardMatrixWheel
} from "../domain/aiMatrixLayout";
import { filterItemsByGroups } from "../domain/sheetGroups";
import { buildGptImage2GenerationRounds } from "../domain/gptImage2Generation";
import type { ImportedWorkbook } from "../services/WorkbookService";
import {
  generateHolopixImages,
  loadHolopixPromptSource,
  recoverRecentHolopixImages,
  type HolopixCompletedBatchSubmission,
  type HolopixSubmissionLifecycleEvent
} from "../ai/holopixClient";
import {
  generateGptImage2Chain,
  recoverRecentGptImage2Images
} from "../ai/gptImage2Client";
import {
  aiWorkflowVersionLabel,
  type AiWorkflowVersion
} from "../ai/aiWorkflowVersion";
import { safeGptImage2OutputName } from "../ai/gptImage2Workflow";
import { HolopixGenerationOutcomeUnknownError } from "../ai/holopixErrors";
import {
  createHolopixImageBlobResource,
  describeHolopixImageBlobFailure,
  type HolopixImageBlobResource
} from "../ai/holopixImageBlob";
import type { HolopixPromptSource } from "../ai/holopixWorkflow";
import { backfillAiCandidate } from "../photoshop/aiCandidateBackfill";
import { inspectActiveReferenceDocument } from "../photoshop/referenceViewController";
import {
  readPsdAiReferencePreview,
  readPsdAiReferenceJpeg,
  type PsdAiReference
} from "../photoshop/psdAiReference";
import { isStablePsdDocumentIdentity } from "../photoshop/psdDocumentIdentity";
import { toErrorMessage } from "../utils/errors";
import {
  holopixPendingSubmissionMatchesScope,
  effectivePendingWorkflowVersion,
  loadHolopixPendingSubmissions,
  persistableHolopixImages,
  promoteHolopixPendingSubmissionToOutput,
  removeHolopixPendingSubmissions,
  saveHolopixPendingSubmission,
  type HolopixPendingSubmissionRecord
} from "../services/HolopixPendingSubmissionService";

interface ThumbnailRecord {
  state: "loading" | "ready" | "error";
  url?: string;
}

interface AiGenerationPanelProps {
  workbook: ImportedWorkbook | null;
  activeGroups: SheetGroup[];
  items: AssetCandidate[];
  psdReferences: PsdAiReference[];
  thumbnails: Record<string, ThumbnailRecord>;
  externalBusy: boolean;
  requestThumbnail: (entry: string) => void;
  onThumbnailError: (entry: string) => void;
  onStatus: (message: string, level?: "info" | "warn" | "error") => void;
  onBusyChange: (busy: boolean) => void;
  onPsdBackfillStart: (documentId: number) => void;
  onPsdBackfillSettled: (replacementMayHaveMutated: boolean) => Promise<void>;
}

type CandidatePreviewState = "ready" | "error";
const AI_CANDIDATE_PREVIEW_SIZE = 64;

interface QueuedFluxGenerationJob {
  workflowVersion: "flux";
  workbook: ImportedWorkbook | null;
  item: AssetCandidate;
  slotIndexes: number[];
  psdReference?: GeneratablePsdReference;
  promptText?: string;
  successMessage?: string;
  failurePrefix: string;
  onSettled?: (result: {
    completedCandidates: number;
    totalCandidates: number;
    unknownCandidates: number;
  }) => void;
}

interface QueuedGptImage2Entry {
  item: AssetCandidate;
  slotIndex: number;
  promptText?: string;
  psdReference: GeneratablePsdReference;
}

interface QueuedGptImage2GenerationJob {
  workflowVersion: "gpt-image-2";
  entries: QueuedGptImage2Entry[];
  successMessage?: string;
  failurePrefix: string;
  onSettled?: (result: {
    completedCandidates: number;
    totalCandidates: number;
    unknownCandidates: number;
  }) => void;
}

type QueuedGenerationJob = QueuedFluxGenerationJob | QueuedGptImage2GenerationJob;

type GeneratablePsdReference = PsdAiReference & (
  | { targetLayerId: number; targetIssue?: undefined }
  | { targetLayerId?: undefined; targetIssue: "missing" }
);

export function AiGenerationPanel({
  workbook,
  activeGroups,
  items,
  psdReferences,
  thumbnails,
  externalBusy,
  requestThumbnail,
  onThumbnailError,
  onStatus,
  onBusyChange,
  onPsdBackfillStart,
  onPsdBackfillSettled
}: AiGenerationPanelProps): React.ReactElement {
  const [open, setOpen] = useState(true);
  const [workflowVersion, setWorkflowVersion] = useState<AiWorkflowVersion>("flux");
  const [candidateCount, setCandidateCount] = useState(2);
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [states, setStates] = useState<Record<string, AiItemState>>({});
  const [selectedItemKey, setSelectedItemKey] = useState("");
  const [running, setRunning] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [syncingCandidateId, setSyncingCandidateId] = useState<string | null>(null);
  const [promptSource, setPromptSource] = useState<HolopixPromptSource | null>(null);
  const [promptDraft, setPromptDraft] = useState("");
  const [promptEditorHeight, setPromptEditorHeight] = useState(86);
  const [psdThumbnails, setPsdThumbnails] = useState<Record<string, ThumbnailRecord>>({});
  const abortRef = useRef<AbortController | null>(null);
  const statesRef = useRef<Record<string, AiItemState>>({});
  const workflowStatesRef = useRef<Record<AiWorkflowVersion, Record<string, AiItemState>>>(
    { flux: {}, "gpt-image-2": {} }
  );
  const generationQueueRef = useRef<QueuedGenerationJob[]>([]);
  const queueProcessingRef = useRef(false);
  const currentPsdScopeKeysRef = useRef(new Set<string>());
  const psdThumbnailRequestsRef = useRef(new Set<string>());
  const psdThumbnailQueueRef = useRef(Promise.resolve());
  const psdThumbnailResourcesRef = useRef(new Map<string, HolopixImageBlobResource>());
  const promptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const promptResizeCleanupRef = useRef<(() => void) | null>(null);
  const matrixViewportRef = useRef<HTMLDivElement | null>(null);
  const matrixContentRef = useRef<HTMLDivElement | null>(null);
  const matrixScrollbarRef = useRef<HTMLDivElement | null>(null);
  const onStatusRef = useRef(onStatus);
  const previewStateReportedRef = useRef({ ready: false, error: false });
  onStatusRef.current = onStatus;
  const reportPreviewState = useCallback((state: CandidatePreviewState, detail?: string): void => {
    if (previewStateReportedRef.current[state]) return;
    previewStateReportedRef.current[state] = true;
    if (state === "ready") {
      onStatusRef.current(
        `AI 候选预览：ImageBlob 原始 RGBA 高清模式已加载${detail ? `；${detail}` : "。"}`
      );
      return;
    }
    onStatusRef.current(
      `AI 候选预览失败：强制 ImageBlob 模式不可用${detail ? `：${detail}` : "。"}`,
      "error"
    );
  }, []);
  currentPsdScopeKeysRef.current = new Set(
    psdReferences.filter(isGeneratableReference).map(psdGenerationScopeKey)
  );
  const startPromptResize = useCallback((event: React.MouseEvent<HTMLSpanElement>): void => {
    const textarea = promptTextareaRef.current;
    if (!textarea) return;
    const startY = event.clientY;
    const startHeight = textarea.getBoundingClientRect().height;
    const move = (moveEvent: MouseEvent): void => {
      setPromptEditorHeight(Math.max(86, Math.min(360, Math.round(startHeight + moveEvent.clientY - startY))));
      moveEvent.preventDefault();
    };
    const cleanup = (): void => {
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", cleanup);
      if (promptResizeCleanupRef.current === cleanup) promptResizeCleanupRef.current = null;
    };
    promptResizeCleanupRef.current?.();
    promptResizeCleanupRef.current = cleanup;
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", cleanup);
    event.preventDefault();
    event.stopPropagation();
  }, []);
  const updateStates = useCallback((
    update: (current: Record<string, AiItemState>) => Record<string, AiItemState>
  ): void => {
    const next = update(statesRef.current);
    statesRef.current = next;
    workflowStatesRef.current[workflowVersion] = next;
    setStates(next);
  }, [workflowVersion]);

  const switchWorkflowVersion = useCallback((nextVersion: AiWorkflowVersion): void => {
    if (nextVersion === workflowVersion) return;
    workflowStatesRef.current[workflowVersion] = statesRef.current;
    const nextStates = workflowStatesRef.current[nextVersion];
    statesRef.current = nextStates;
    setStates(nextStates);
    setWorkflowVersion(nextVersion);
  }, [workflowVersion]);
  const selectedGroup = activeGroups.find((group) => group.id === selectedGroupId) ?? activeGroups[0];
  const groupItems = useMemo(
    () => selectedGroup ? filterItemsByGroups(items, [selectedGroup]) : [],
    [items, selectedGroup]
  );
  const psdReferencesByAssetCode = useMemo(
    () => new Map(psdReferences.map((reference) => [reference.assetCode, reference])),
    [psdReferences]
  );
  const generatablePsdReferencesByAssetCode = useMemo(
    () => new Map(
      psdReferences
        .filter(isGeneratableReference)
        .map((reference) => [reference.assetCode, reference])
    ),
    [psdReferences]
  );
  const generationItems = useMemo(
    () => groupItems.filter((item) => generatablePsdReferencesByAssetCode.has(item.assetCode)),
    [generatablePsdReferencesByAssetCode, groupItems]
  );
  const itemStates = groupItems.flatMap((item) => states[item.key] ? [states[item.key]!] : []);
  const stats = summarizeAiCandidates(itemStates);
  const selectedItem = groupItems.find((item) => item.key === selectedItemKey) ?? groupItems[0];
  const runtimePromptText = useMemo(() => {
    if (!selectedItem) return "";
    const candidates = states[selectedItem.key]?.candidates ?? [];
    const acceptedPrompt = candidates.find((candidate) => candidate.status === "accepted")
      ?.image?.promptText?.trim();
    return acceptedPrompt ?? candidates.find((candidate) => candidate.image?.promptText?.trim())
      ?.image?.promptText?.trim()
      ?? (workflowVersion === "gpt-image-2" ? selectedItem.name?.trim() || selectedItem.assetCode : "");
  }, [selectedItem, states, workflowVersion]);
  const controlsDisabled = externalBusy || running || recovering || Boolean(syncingCandidateId);
  const countControlsDisabled = externalBusy || recovering || Boolean(syncingCandidateId);
  const backfillDisabled = externalBusy || recovering || Boolean(syncingCandidateId);
  const promptRegenerationDisabled = externalBusy || recovering || Boolean(syncingCandidateId);
  const remainingCount = itemStates.reduce(
    (count, state) => count + state.candidates.filter(
      (candidate) => candidate.status === "idle" || candidate.status === "failed"
    ).length,
    0
  );
  const displayedCandidateCount = Math.max(
    candidateCount,
    ...itemStates.map((state) => state.candidates.length)
  );
  const matrixWidth = aiCandidateMatrixWidth(displayedCandidateCount);

  useEffect(() => {
    if (!activeGroups.length) {
      setSelectedGroupId("");
      return;
    }
    if (!activeGroups.some((group) => group.id === selectedGroupId)) {
      setSelectedGroupId(activeGroups[0]!.id);
    }
  }, [activeGroups, selectedGroupId]);

  useEffect(() => {
    if (running) return;
    const pendingRecords = loadHolopixPendingSubmissions().filter(
      (record) => effectivePendingWorkflowVersion(record) === workflowVersion
    );
    updateStates((current) => {
      const next = reconcileAiItemStates(current, generationItems, candidateCount);
      for (const item of generationItems) {
        const reference = generatablePsdReferencesByAssetCode.get(item.assetCode);
        let state = next[item.key];
        if (!reference || !state) continue;
        for (const pending of pendingRecords) {
          if (!pendingSubmissionMatchesReference(pending, reference, workflowVersion)) continue;
          state = restoreAiPendingSubmission(state, pending);
        }
        next[item.key] = state;
      }
      return next;
    });
  }, [candidateCount, generatablePsdReferencesByAssetCode, generationItems, running, updateStates, workflowVersion]);

  useEffect(() => {
    if (!groupItems.some((item) => item.key === selectedItemKey)) {
      setSelectedItemKey(groupItems[0]?.key ?? "");
    }
  }, [groupItems, selectedItemKey]);

  useEffect(() => {
    setPromptDraft(runtimePromptText);
  }, [runtimePromptText, selectedItem?.key]);

  useEffect(() => {
    if (!open) return;
    const matrixViewport = matrixViewportRef.current;
    const matrixContent = matrixContentRef.current;
    const matrixScrollbar = matrixScrollbarRef.current;
    if (!matrixViewport || !matrixContent || !matrixScrollbar) return;
    matrixContent.style.transform = "";
    matrixViewport.scrollLeft = 0;
    const syncHorizontalPosition = (): void => {
      const offset = clampAiMatrixScrollLeft(
        matrixScrollbar.scrollLeft,
        matrixWidth,
        matrixViewport.clientWidth
      );
      matrixContent.style.marginLeft = offset ? `-${offset}px` : "0px";
    };
    const handleWheel = (event: WheelEvent): void => {
      if (!shouldForwardMatrixWheel(event.deltaX, event.deltaY, event.shiftKey)) return;
      const outerPanel = document.querySelector<HTMLElement>(".app");
      if (!outerPanel) return;
      const scale = event.deltaMode === 1
        ? 32
        : event.deltaMode === 2
          ? outerPanel.clientHeight
          : 1;
      outerPanel.scrollTop += event.deltaY * scale;
      event.preventDefault();
      event.stopPropagation();
    };
    matrixScrollbar.scrollLeft = clampAiMatrixScrollLeft(
      matrixScrollbar.scrollLeft,
      matrixWidth,
      matrixViewport.clientWidth
    );
    syncHorizontalPosition();
    matrixScrollbar.addEventListener("scroll", syncHorizontalPosition);
    matrixScrollbar.addEventListener("wheel", handleWheel, true);
    return () => {
      matrixScrollbar.removeEventListener("scroll", syncHorizontalPosition);
      matrixScrollbar.removeEventListener("wheel", handleWheel, true);
    };
  }, [matrixWidth, open]);

  useEffect(() => {
    for (const item of groupItems) {
      const reference = psdReferencesByAssetCode.get(item.assetCode);
      if (!reference) continue;
      const key = psdReferenceKey(reference);
      if (psdThumbnailRequestsRef.current.has(key)) continue;
      psdThumbnailRequestsRef.current.add(key);
      setPsdThumbnails((current) => ({ ...current, [key]: { state: "loading" } }));
      const load = async (): Promise<void> => {
        try {
          const resource = await readPsdAiReferencePreview(reference);
          psdThumbnailResourcesRef.current.get(key)?.revoke();
          psdThumbnailResourcesRef.current.set(key, resource);
          setPsdThumbnails((current) => ({
            ...current,
            [key]: { state: "ready", url: resource.url }
          }));
        } catch (error) {
          setPsdThumbnails((current) => ({ ...current, [key]: { state: "error" } }));
          onStatus(`读取当前 PSD 参考图 ${item.assetCode} 失败：${toErrorMessage(error)}`, "warn");
        }
      };
      psdThumbnailQueueRef.current = psdThumbnailQueueRef.current.then(load, load);
    }
  }, [groupItems, onStatus, psdReferencesByAssetCode]);

  useEffect(() => {
    for (const item of groupItems) {
      if (psdReferencesByAssetCode.has(item.assetCode)) continue;
      const image = selectedAiReferenceImage(item);
      if (image && !thumbnails[image.anchor.archiveEntry]) requestThumbnail(image.anchor.archiveEntry);
    }
  }, [groupItems, psdReferencesByAssetCode, requestThumbnail, thumbnails]);

  useEffect(() => () => {
    generationQueueRef.current = [];
    abortRef.current?.abort();
    promptResizeCleanupRef.current?.();
    for (const resource of psdThumbnailResourcesRef.current.values()) resource.revoke();
    psdThumbnailResourcesRef.current.clear();
  }, []);

  useEffect(() => {
    let active = true;
    if (!selectedItem) {
      setPromptSource(null);
      return () => {
        active = false;
      };
    }
    if (workflowVersion === "gpt-image-2") {
      setPromptSource({
        kind: "unknown",
        label: "GptImage2.json",
        detail: "GPT Image 2 使用工作流内置风格参考；这里编辑当前物品描述。"
      });
      return () => {
        active = false;
      };
    }
    void loadHolopixPromptSource().then(
      (source) => {
        if (active) setPromptSource(source);
      },
      (error) => {
        if (active) {
          setPromptSource({
            kind: "unknown",
            label: "Holopix.json",
            detail: `读取工作流提示词失败：${toErrorMessage(error)}`
          });
        }
      }
    );
    return () => {
      active = false;
    };
  }, [selectedItem?.assetCode, selectedItem?.name, workflowVersion]);

  useEffect(() => {
    onBusyChange(running || recovering || Boolean(syncingCandidateId));
    return () => onBusyChange(false);
  }, [onBusyChange, recovering, running, syncingCandidateId]);

  async function handleRecoverExisting(): Promise<void> {
    if (!selectedGroup || controlsDisabled || !generationItems.length) return;
    setRecovering(true);
    try {
      if (workflowVersion === "gpt-image-2") {
        await recoverGptImage2Candidates();
        return;
      }
      const persistedPending = loadHolopixPendingSubmissions();
      const pendingSubmissions = generationItems.flatMap((item) => (
        statesRef.current[item.key]?.candidates.flatMap((candidate) => (
          candidate.status === "unknown" && candidate.submissionPromptId
            ? [{ promptId: candidate.submissionPromptId, assetCode: item.assetCode }]
            : []
        )) ?? []
      ));
      const recovered = await recoverRecentHolopixImages(
        generationItems.map((item) => item.assetCode),
        candidateCount,
        undefined,
        (message) => onStatus(`Holopix 安全预览：${message}`),
        pendingSubmissions
      );
      let recoveredCount = 0;
      const resolvedOutputRecords = new Map<string, HolopixPendingSubmissionRecord>();
      updateStates((current) => {
        const next = reconcileAiItemStates(current, generationItems, candidateCount);
        for (const item of generationItems) {
          let state = next[item.key];
          if (!state) continue;
          const promptIds = new Set(state.candidates.flatMap((candidate) => (
            candidate.status === "unknown" && candidate.submissionPromptId
              ? [candidate.submissionPromptId]
              : []
          )));
          for (const promptId of promptIds) {
            const exactImages = recovered.byPromptId[promptId] ?? [];
            const merged = mergeRecoveredAiCandidateImages(
              state,
              exactImages,
              { promptId }
            );
            state = merged.item;
            recoveredCount += merged.recoveredCount;
            if (!state.candidates.some((candidate) => (
              candidate.status === "unknown" && candidate.submissionPromptId === promptId
            ))) {
              const reference = generatablePsdReferencesByAssetCode.get(item.assetCode);
              if (reference) {
                for (const pending of persistedPending) {
                  if (
                    pending.promptId === promptId
                    && pendingSubmissionMatchesReference(pending, reference)
                  ) {
                    resolvedOutputRecords.set(
                      pending.submissionKey,
                      promoteHolopixPendingSubmissionToOutput(pending, exactImages)
                    );
                  }
                }
              }
            }
          }
          const mergedRecent = mergeRecoveredAiCandidateImages(
            state,
            recovered.recentByAssetCode[item.assetCode] ?? []
          );
          next[item.key] = mergedRecent.item;
          recoveredCount += mergedRecent.recoveredCount;
        }
        return { ...next };
      });
      let outputRecordFailures = 0;
      for (const record of resolvedOutputRecords.values()) {
        if (!saveHolopixPendingSubmission(record)) outputRecordFailures += 1;
      }
      const detail = recoveredCount
        ? `已从 ComfyUI 历史恢复 ${recoveredCount} 张候选；未提交新生成任务。`
        : "ComfyUI 历史中没有找到当前棋子链的已有候选。";
      onStatus(detail, recoveredCount ? "info" : "warn");
      if (outputRecordFailures) {
        onStatus(
          `已有候选已恢复，但 ${outputRecordFailures} 个本地付费输出记录更新失败；`
            + "已保留待确认保护，请勿直接重复生成。",
          "warn"
        );
      }
    } catch (error) {
      const detail = `恢复已有候选失败：${toErrorMessage(error)}`;
      onStatus(detail, "error");
    } finally {
      setRecovering(false);
    }
  }

  async function recoverGptImage2Candidates(): Promise<void> {
    const persistedPending = loadHolopixPendingSubmissions().filter(
      (record) => effectivePendingWorkflowVersion(record) === "gpt-image-2"
    );
    const pendingSubmissions = generationItems.flatMap((item) => (
      statesRef.current[item.key]?.candidates.flatMap((candidate) => (
        candidate.status === "unknown" && candidate.submissionPromptId
          ? [{ promptId: candidate.submissionPromptId, assetCode: item.assetCode }]
          : []
      )) ?? []
    ));
    const recovered = await recoverRecentGptImage2Images(
      generationItems.map((item) => ({
        assetCode: item.assetCode,
        itemName: item.name?.trim() || item.assetCode
      })),
      candidateCount,
      undefined,
      (message) => onStatus(`GPT Image 2 安全预览：${message}`),
      pendingSubmissions
    );
    let recoveredCount = 0;
    const resolvedOutputRecords = new Map<string, HolopixPendingSubmissionRecord>();
    updateStates((current) => {
      const next = reconcileAiItemStates(current, generationItems, candidateCount);
      for (const item of generationItems) {
        let state = next[item.key];
        if (!state) continue;
        const promptIds = new Set(state.candidates.flatMap((candidate) => (
          candidate.status === "unknown" && candidate.submissionPromptId
            ? [candidate.submissionPromptId]
            : []
        )));
        for (const promptId of promptIds) {
          const exactImages = recovered.byPromptId[promptId]?.[item.assetCode] ?? [];
          const merged = mergeRecoveredAiCandidateImages(state, exactImages, { promptId });
          state = merged.item;
          recoveredCount += merged.recoveredCount;
          if (!state.candidates.some((candidate) => (
            candidate.status === "unknown" && candidate.submissionPromptId === promptId
          ))) {
            const reference = generatablePsdReferencesByAssetCode.get(item.assetCode);
            if (reference) {
              for (const pending of persistedPending) {
                if (
                  pending.promptId === promptId
                  && pendingSubmissionMatchesReference(pending, reference, "gpt-image-2")
                ) {
                  resolvedOutputRecords.set(
                    pending.submissionKey,
                    promoteHolopixPendingSubmissionToOutput(pending, exactImages)
                  );
                }
              }
            }
          }
        }
        const mergedRecent = mergeRecoveredAiCandidateImages(
          state,
          recovered.recentByAssetCode[item.assetCode] ?? []
        );
        next[item.key] = mergedRecent.item;
        recoveredCount += mergedRecent.recoveredCount;
      }
      return { ...next };
    });
    let outputRecordFailures = 0;
    for (const record of resolvedOutputRecords.values()) {
      if (!saveHolopixPendingSubmission(record)) outputRecordFailures += 1;
    }
    onStatus(
      recoveredCount
        ? `已从 ComfyUI 历史恢复 ${recoveredCount} 张 GPT Image 2 候选；未提交新生成任务。`
        : "ComfyUI 历史中没有找到当前棋子链的 GPT Image 2 候选。",
      recoveredCount ? "info" : "warn"
    );
    if (outputRecordFailures) {
      onStatus(
        `GPT Image 2 候选已恢复，但 ${outputRecordFailures} 个本地输出记录更新失败；已保留待确认保护。`,
        "warn"
      );
    }
  }

  function handleAbandonUnknowns(): void {
    if (!stats.unknown || controlsDisabled) return;
    const confirmed = window.confirm(
      "仅在你已经确认 ComfyUI 中没有仍在运行或尚未取回的对应任务时继续。\n\n"
      + "放弃后，这些格子会变成可重试；再次生成可能产生新的付费任务。"
    );
    if (!confirmed) return;
    const submissionKeys = new Set<string>();
    let abandonedCount = 0;
    updateStates((current) => {
      const next = { ...current };
      for (const item of generationItems) {
        const state = next[item.key];
        if (!state) continue;
        const abandoned = abandonAiCandidateUnknowns(state);
        next[item.key] = abandoned.item;
        abandonedCount += abandoned.abandonedCount;
        for (const key of abandoned.submissionKeys) submissionKeys.add(key);
      }
      return next;
    });
    removeHolopixPendingSubmissions(submissionKeys);
    onStatus(
      `已确认放弃 ${abandonedCount} 张待确认候选；请先检查“恢复已有候选（不生成）”，再决定是否重新生成。`,
      "warn"
    );
  }

  function enqueueGeneration(job: QueuedGenerationJob): void {
    generationQueueRef.current.push(job);
    void processGenerationQueue();
  }

  async function processGenerationQueue(): Promise<void> {
    if (queueProcessingRef.current) return;
    queueProcessingRef.current = true;
    setRunning(true);
    try {
      while (generationQueueRef.current.length) {
        const job = generationQueueRef.current.shift()!;
        if (job.workflowVersion === "gpt-image-2") {
          await processGptImage2GenerationJob(job);
          continue;
        }
        if (
          job.psdReference
          && !currentPsdScopeKeysRef.current.has(psdGenerationScopeKey(job.psdReference))
        ) {
          const detail = "未提交生成：当前 PSD 或节点范围已经切换。";
          updateStates((current) => {
            const state = current[job.item.key];
            return state ? {
              ...current,
              [job.item.key]: failAiCandidateGenerationRemainder(
                state,
                job.slotIndexes,
                0,
                detail,
                job.promptText
              )
            } : current;
          });
          onStatus(`Holopix ${job.item.assetCode} ${detail}`, "warn");
          job.onSettled?.({
            completedCandidates: 0,
            totalCandidates: job.slotIndexes.length,
            unknownCandidates: 0
          });
          continue;
        }
        const controller = new AbortController();
        abortRef.current = controller;
        let success = false;
        let completedSlotCount = 0;
        let unknownSlotCount = 0;
        let resolvedPromptText = job.promptText?.trim() || undefined;
        onStatus(`Holopix ${job.item.assetCode} 开始生成 ${job.slotIndexes.length} 张候选。`);
        updateStates((current) => updateSlotIndexes(
          current,
          job.item.key,
          job.slotIndexes,
          (slot) => ({ ...slot, status: "generating", error: undefined })
        ));
        try {
          const images = await runItemGeneration(
            job.workbook,
            job.item,
            job.slotIndexes.length,
            controller.signal,
            (message) => onStatus(`Holopix ${job.item.assetCode}：${message}`),
            job.promptText,
            job.psdReference,
            (batchImages, completedBeforeBatch, _totalCandidates, submission) => {
              resolvedPromptText ??= batchImages[0]?.promptText?.trim() || undefined;
              updateStates((current) => {
                const state = current[job.item.key];
                return state ? {
                  ...current,
                  [job.item.key]: applyAiGeneratedCandidateBatch(
                    state,
                    job.slotIndexes,
                    completedBeforeBatch,
                    batchImages,
                    resolvedPromptText,
                    submission
                  )
                } : current;
              });
              completedSlotCount = Math.max(
                completedSlotCount,
                completedBeforeBatch + batchImages.length
              );
            },
            async () => {
              if (
                job.psdReference
                && !currentPsdScopeKeysRef.current.has(psdGenerationScopeKey(job.psdReference))
              ) {
                throw new Error("当前 PSD 或节点范围已经切换；后续 Holopix 批次未提交。");
              }
              if (job.psdReference) await assertActivePsdGenerationScope(job.psdReference);
            },
            (event) => recordSubmissionLifecycle(job, event)
          );
          updateStates((current) => updateSlotIndexes(
            current,
            job.item.key,
            job.slotIndexes,
            (slot, offset) => ({
              ...slot,
              status: slot.status === "accepted" ? "accepted" : "ready",
              image: images[offset]!,
              error: undefined,
              retryPromptText: images[offset]?.promptText?.trim() || resolvedPromptText || slot.retryPromptText
            })
          ));
          success = true;
          if (job.successMessage) onStatus(job.successMessage);
        } catch (error) {
          const detail = toErrorMessage(error);
          const failedSlotIndexes = job.slotIndexes.slice(completedSlotCount);
          if (error instanceof HolopixGenerationOutcomeUnknownError) {
            unknownSlotCount = failedSlotIndexes.length;
            updateStates((current) => {
              const state = current[job.item.key];
              return state ? {
                ...current,
                [job.item.key]: markAiCandidateGenerationUnknown(
                  state,
                  job.slotIndexes,
                  completedSlotCount,
                  detail,
                  { promptId: error.promptId, key: error.submissionKey },
                  resolvedPromptText
                )
              } : current;
            });
            onStatus(
              `${job.failurePrefix}：${detail} 请稍后使用“恢复已有候选（不生成）”核对结果。`,
              "warn"
            );
          } else if (!failedSlotIndexes.length && completedSlotCount === job.slotIndexes.length) {
            success = true;
            onStatus(
              `Holopix ${job.item.assetCode} 原图已全部保留；安全预览增强未完成：${detail}`,
              "warn"
            );
          } else {
            updateStates((current) => {
              const state = current[job.item.key];
              return state ? {
                ...current,
                [job.item.key]: failAiCandidateGenerationRemainder(
                  state,
                  job.slotIndexes,
                  completedSlotCount,
                  detail,
                  resolvedPromptText
                )
              } : current;
            });
          }
          if (completedSlotCount > 0 && failedSlotIndexes.length) {
            onStatus(
              `Holopix ${job.item.assetCode} 已保留前 ${completedSlotCount} 张成功候选；剩余 ${failedSlotIndexes.length} 张`
                + `${error instanceof HolopixGenerationOutcomeUnknownError ? "结果待确认" : "标记为失败"}。`,
              "warn"
            );
          }
          if (!(error instanceof HolopixGenerationOutcomeUnknownError) && !success) {
            onStatus(`${job.failurePrefix}：${detail}`, "error");
          }
        } finally {
          if (abortRef.current === controller) abortRef.current = null;
          job.onSettled?.({
            completedCandidates: success ? job.slotIndexes.length : completedSlotCount,
            totalCandidates: job.slotIndexes.length,
            unknownCandidates: unknownSlotCount
          });
        }
      }
    } finally {
      queueProcessingRef.current = false;
      setRunning(false);
    }
  }

  async function processGptImage2GenerationJob(
    job: QueuedGptImage2GenerationJob
  ): Promise<void> {
    const totalCandidates = job.entries.length;
    if (!totalCandidates) return;
    const inactive = job.entries.some((entry) => (
      !currentPsdScopeKeysRef.current.has(psdGenerationScopeKey(entry.psdReference))
    ));
    if (inactive) {
      const detail = "未提交整链：当前 PSD 或节点范围已经切换。";
      updateStates((current) => failGptImage2Entries(current, job.entries, detail));
      onStatus(`GPT Image 2 ${detail}`, "warn");
      job.onSettled?.({ completedCandidates: 0, totalCandidates, unknownCandidates: 0 });
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    const completedAssetCodes = new Set<string>();
    let unknownCandidates = 0;
    let success = false;
    updateStates((current) => updateGptImage2Entries(current, job.entries, (slot) => ({
      ...slot,
      status: "generating",
      error: undefined
    })));
    onStatus(`GPT Image 2 开始整链生成：本轮 ${totalCandidates} 个物品。`);
    try {
      await generateGptImage2Chain({
        items: job.entries.map((entry) => ({
          assetCode: entry.item.assetCode,
          itemName: entry.item.name?.trim() || entry.item.assetCode,
          ...(entry.promptText?.trim() ? { promptText: entry.promptText.trim() } : {})
        })),
        signal: controller.signal,
        onStage: (message) => onStatus(`GPT Image 2：${message}`),
        onBeforeSubmit: async () => {
          for (const entry of job.entries) {
            if (!currentPsdScopeKeysRef.current.has(psdGenerationScopeKey(entry.psdReference))) {
              throw new Error("当前 PSD 或节点范围已经切换；GPT Image 2 整链未提交。");
            }
            await assertActivePsdGenerationScope(entry.psdReference);
          }
        },
        onSubmissionLifecycle: (event) => recordGptImage2SubmissionLifecycle(job, event),
        onImagesReady: (imagesByAssetCode, submission) => {
          updateStates((current) => {
            let next = current;
            for (const entry of job.entries) {
              const image = imagesByAssetCode[entry.item.assetCode];
              if (!image) continue;
              completedAssetCodes.add(entry.item.assetCode);
              const state = next[entry.item.key];
              if (!state) continue;
              next = {
                ...next,
                [entry.item.key]: applyAiGeneratedCandidateBatch(
                  state,
                  [entry.slotIndex],
                  0,
                  [image],
                  image.promptText,
                  {
                    promptId: submission.promptId,
                    key: gptImage2ItemSubmissionKey(submission.key, entry.item.assetCode)
                  }
                )
              };
            }
            return next;
          });
        }
      });
      success = true;
      onStatus(job.successMessage ?? `GPT Image 2 整链完成：${totalCandidates} 个物品。`);
    } catch (error) {
      const detail = toErrorMessage(error);
      const remaining = job.entries.filter(
        (entry) => !completedAssetCodes.has(entry.item.assetCode)
      );
      if (error instanceof HolopixGenerationOutcomeUnknownError) {
        unknownCandidates = remaining.length;
        updateStates((current) => markGptImage2EntriesUnknown(
          current,
          remaining,
          detail,
          error.promptId,
          error.submissionKey
        ));
        onStatus(
          `${job.failurePrefix}：${detail} 请稍后使用“恢复已有候选（不生成）”核对结果。`,
          "warn"
        );
      } else if (remaining.length) {
        updateStates((current) => failGptImage2Entries(current, remaining, detail));
        onStatus(`${job.failurePrefix}：${detail}`, "error");
      } else {
        success = true;
        onStatus(`GPT Image 2 已保留本轮全部拆分结果；后处理提示：${detail}`, "warn");
      }
      if (completedAssetCodes.size && remaining.length) {
        onStatus(
          `GPT Image 2 已保留 ${completedAssetCodes.size} 个成功物品；其余 ${remaining.length} 个`
          + `${error instanceof HolopixGenerationOutcomeUnknownError ? "结果待确认" : "标记为失败"}。`,
          "warn"
        );
      }
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      job.onSettled?.({
        completedCandidates: success ? totalCandidates : completedAssetCodes.size,
        totalCandidates,
        unknownCandidates
      });
    }
  }

  async function handleBulkGenerate(): Promise<void> {
    if (!selectedGroup || running) return;
    if (workflowVersion === "gpt-image-2") {
      handleGptImage2BulkGenerate();
      return;
    }
    const snapshot = reconcileAiItemStates(statesRef.current, generationItems, candidateCount);
    const jobs = generationItems.flatMap((item) => {
      const state = snapshot[item.key];
      if (!state) return [];
      return buildAiCandidateGenerationBatches(state.candidates).map((batch) => ({
        item,
        slotIndexes: batch.slotIndexes,
        promptText: batch.promptText
      }));
    });
    const totalCandidates = jobs.reduce((count, job) => count + job.slotIndexes.length, 0);
    if (!totalCandidates) {
      onStatus("当前棋子链没有待生成或失败的候选。", "warn");
      return;
    }
    updateStates(() => markSlots(snapshot, jobs, "queued"));
    onStatus(`Holopix 批量生成开始：${jobs.length} 项，${totalCandidates} 张候选。`);

    let completedJobs = 0;
    let failedCandidates = 0;
    let unknownCandidates = 0;
    for (const job of jobs) {
      enqueueGeneration({
        workflowVersion: "flux",
        workbook,
        item: job.item,
        slotIndexes: job.slotIndexes,
        promptText: job.promptText,
        psdReference: generatablePsdReferencesByAssetCode.get(job.item.assetCode),
        failurePrefix: `Holopix ${job.item.assetCode} 生成失败`,
        onSettled: (result) => {
          unknownCandidates += result.unknownCandidates;
          failedCandidates += result.totalCandidates
            - result.completedCandidates
            - result.unknownCandidates;
          completedJobs += 1;
          onStatus(
            `Holopix 批次进度 ${completedJobs}/${jobs.length}`
            + `${failedCandidates ? `；待重试 ${failedCandidates} 张` : ""}`
            + `${unknownCandidates ? `；结果待确认 ${unknownCandidates} 张` : ""}。`
          );
          if (completedJobs === jobs.length) {
            const detail = failedCandidates || unknownCandidates
              ? `Holopix 批量结束：${totalCandidates - failedCandidates - unknownCandidates} 张成功，`
                + `${failedCandidates} 张失败，${unknownCandidates} 张结果待确认。`
              : `Holopix 批量完成：${jobs.length} 项，共 ${totalCandidates} 张候选。`;
            onStatus(detail, failedCandidates || unknownCandidates ? "warn" : "info");
          }
        }
      });
    }
  }

  function handleGptImage2BulkGenerate(): void {
    const snapshot = reconcileAiItemStates(statesRef.current, generationItems, candidateCount);
    const rounds = buildGptImage2GenerationRounds(generationItems, snapshot);
    const jobs = rounds.flatMap((round) => {
      const entries = round.entries.flatMap((entry) => {
        const psdReference = generatablePsdReferencesByAssetCode.get(entry.item.assetCode);
        return psdReference ? [{
          item: entry.item,
          slotIndex: round.slotIndex,
          ...(entry.promptText ? { promptText: entry.promptText } : {}),
          psdReference
        }] : [];
      });
      return entries.length ? [{ entries }] : [];
    });
    const totalCandidates = jobs.reduce((count, job) => count + job.entries.length, 0);
    if (!totalCandidates) {
      onStatus("当前棋子链没有待生成或失败的 GPT Image 2 候选。", "warn");
      return;
    }
    updateStates(() => markSlots(
      snapshot,
      jobs.flatMap((job) => job.entries.map((entry) => ({
        item: entry.item,
        slotIndexes: [entry.slotIndex]
      }))),
      "queued"
    ));
    onStatus(
      `GPT Image 2 批量开始：整链运行 ${jobs.length} 轮，共回填 ${totalCandidates} 个候选格。`
    );

    let completedJobs = 0;
    let failedCandidates = 0;
    let unknownCandidates = 0;
    for (const job of jobs) {
      enqueueGeneration({
        workflowVersion: "gpt-image-2",
        entries: job.entries,
        failurePrefix: "GPT Image 2 整链生成失败",
        onSettled: (result) => {
          unknownCandidates += result.unknownCandidates;
          failedCandidates += result.totalCandidates
            - result.completedCandidates
            - result.unknownCandidates;
          completedJobs += 1;
          onStatus(
            `GPT Image 2 整链进度 ${completedJobs}/${jobs.length}`
            + `${failedCandidates ? `；待重试 ${failedCandidates} 张` : ""}`
            + `${unknownCandidates ? `；结果待确认 ${unknownCandidates} 张` : ""}。`
          );
          if (completedJobs === jobs.length) {
            onStatus(
              failedCandidates || unknownCandidates
                ? `GPT Image 2 批量结束：${totalCandidates - failedCandidates - unknownCandidates} 张成功，`
                  + `${failedCandidates} 张失败，${unknownCandidates} 张结果待确认。`
                : `GPT Image 2 批量完成：整链 ${jobs.length} 轮，共 ${totalCandidates} 张候选。`,
              failedCandidates || unknownCandidates ? "warn" : "info"
            );
          }
        }
      });
    }
  }

  async function handleRegenerate(item: AssetCandidate, slotIndex: number): Promise<void> {
    if (controlsDisabled) return;
    if (workflowVersion === "gpt-image-2") {
      setSelectedItemKey(item.key);
      return;
    }
    const state = statesRef.current[item.key];
    if (!state) return;
    const retryPromptText = state.candidates[slotIndex]?.retryPromptText;
    setSelectedItemKey(item.key);
    updateStates((current) => updateSlotIndexes(current, item.key, [slotIndex], (slot) => ({
      ...slot,
      status: "queued",
      error: undefined
    })));
    const psdReference = generatablePsdReferencesByAssetCode.get(item.assetCode);
    enqueueGeneration({
      workflowVersion: "flux",
      workbook,
      item,
      slotIndexes: [slotIndex],
      promptText: retryPromptText,
      psdReference,
      successMessage: `Holopix 单格重生成完成：${item.assetCode}。`,
      failurePrefix: `Holopix ${item.assetCode} 单格生成失败`
    });
  }

  async function handleRegenerateSelected(): Promise<void> {
    const item = selectedItem;
    const promptText = promptDraft.trim();
    if (
      !item || !generationItems.some((candidate) => candidate.key === item.key) ||
      !promptText || promptRegenerationDisabled
    ) return;
    const snapshot = reconcileAiItemStates(statesRef.current, generationItems, candidateCount);
    if (workflowVersion === "gpt-image-2") {
      const rounds: QueuedGptImage2Entry[][] = [];
      let next = { ...snapshot };
      for (const chainItem of generationItems) {
        const state = next[chainItem.key];
        const psdReference = generatablePsdReferencesByAssetCode.get(chainItem.assetCode);
        if (!state || !psdReference) continue;
        const itemPromptText = chainItem.key === item.key ? promptText : undefined;
        const appendedState = appendAiCandidateSlots(state, candidateCount, itemPromptText);
        const appendedCount = appendedState.candidates.length - state.candidates.length;
        next = { ...next, [chainItem.key]: appendedState };
        for (let offset = 0; offset < appendedCount; offset += 1) {
          const entries = rounds[offset] ?? [];
          entries.push({
            item: chainItem,
            slotIndex: state.candidates.length + offset,
            ...(itemPromptText ? { promptText: itemPromptText } : {}),
            psdReference
          });
          rounds[offset] = entries;
        }
      }
      updateStates(() => next);
      onStatus(
        `GPT Image 2 已为当前选中链的 ${generationItems.length} 个物品各追加 ${rounds.length} 张候选；`
        + `整链将排队运行 ${rounds.length} 轮。`
      );
      for (const entries of rounds) {
        enqueueGeneration({
          workflowVersion: "gpt-image-2",
          entries,
          successMessage: `GPT Image 2 已用修改后的物品描述重新生成当前选中链。`,
          failurePrefix: "GPT Image 2 选中链重新生成失败"
        });
      }
      return;
    }
    const state = snapshot[item.key];
    if (!state) return;
    const appendedState = appendAiCandidateSlots(state, candidateCount, promptText);
    const slotIndexes = Array.from(
      { length: appendedState.candidates.length - state.candidates.length },
      (_, offset) => state.candidates.length + offset
    );
    updateStates(() => ({ ...snapshot, [item.key]: appendedState }));
    const psdReference = generatablePsdReferencesByAssetCode.get(item.assetCode);
    onStatus(`Holopix ${item.assetCode} 已追加 ${slotIndexes.length} 张候选，正在安全单队列中等待生成。`);
    enqueueGeneration({
      workflowVersion: "flux",
      workbook,
      item,
      slotIndexes,
      promptText,
      psdReference,
      successMessage: `Holopix 已用修改后的提示词生成新增候选：${item.assetCode}。`,
      failurePrefix: `Holopix ${item.assetCode} 新增候选生成失败`
    });
  }

  async function handleAccept(item: AssetCandidate, candidate: AiCandidateSlot): Promise<void> {
    if (!candidate.image || backfillDisabled) return;
    const psdReference = generatablePsdReferencesByAssetCode.get(item.assetCode);
    if (!psdReference) {
      onStatus(`无法回填 ${item.assetCode}：当前 PSD 中没有可唯一定位的对应节点。`, "warn");
      return;
    }
    const geometryAudit: string[] = [];
    setSelectedItemKey(item.key);
    onPsdBackfillStart(psdReference.documentId);
    setSyncingCandidateId(candidate.id);
    let replacementMayHaveMutated = false;
    try {
      const result = await backfillAiCandidate(
        item.assetCode,
        candidate.image.url,
        {
          documentId: psdReference.documentId,
          artboardId: psdReference.artboardId,
          referenceLayerId: psdReference.referenceLayerId,
          targetLayerId: psdReference.targetLayerId,
          targetIssue: psdReference.targetIssue
        },
        (message) => geometryAudit.push(message),
        () => { replacementMayHaveMutated = true; }
      );
      if (result.applied) {
        updateStates((current) => {
          const state = current[item.key];
          return state ? { ...current, [item.key]: acceptAiCandidate(state, candidate.id) } : current;
        });
      }
      const detail = result.applied
        ? `${result.detail} 可继续点击同一行的其他候选，在画板中直接对比。`
        : result.detail;
      onStatus(detail, result.applied ? "info" : "warn");
    } catch (error) {
      const detail = `候选已选中，但回填 PSD 失败：${toErrorMessage(error)}`;
      onStatus(detail, "error");
    } finally {
      for (const message of geometryAudit) onStatus(`回填几何 ${item.assetCode}：${message}`);
      try {
        await onPsdBackfillSettled(replacementMayHaveMutated);
      } catch (error) {
        onStatus(`回填结束后重新读取 PSD 节点失败：${toErrorMessage(error)}`, "warn");
      }
      setSyncingCandidateId(null);
    }
  }

  return (
    <section className={`panel-section ai-panel ${open ? "is-open" : ""}`}>
      <div
        className="panel-section-toggle ai-panel-toggle"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setOpen((value) => !value);
          }
        }}
      >
        <span className={`panel-disclosure ${open ? "is-open" : ""}`} aria-hidden="true">
          {open ? "⌄" : ">"}
        </span>
        <span>AI 生成</span>
      </div>
      {open ? (
        <div className="panel-section-content ai-panel-content">
          <div className="ai-workflow-select">
            <select
              id="ai-workflow-version"
              aria-label="AI 生成版本"
              value={workflowVersion}
              disabled={controlsDisabled}
              onChange={(event) => switchWorkflowVersion(event.currentTarget.value as AiWorkflowVersion)}
            >
              <option value="flux">Flux</option>
              <option value="gpt-image-2">GPT Image 2</option>
            </select>
          </div>
          <div className="ai-generation-card">
            <div className="ai-generation-summary">
              <span>每个物品生成</span>
              <div className="ai-stepper" aria-label="每个棋子候选数量">
                <button
                  className="compact"
                  disabled={countControlsDisabled || candidateCount <= 1}
                  onClick={() => setCandidateCount((value) => Math.max(1, value - 1))}
                >−</button>
                <strong>{candidateCount}</strong>
                <button
                  className="compact"
                  disabled={countControlsDisabled || candidateCount >= 4}
                  onClick={() => setCandidateCount((value) => Math.min(4, value + 1))}
                >＋</button>
              </div>
            </div>
            <button
              className="primary ai-generate-all"
              disabled={controlsDisabled || !selectedGroup || !generationItems.length || remainingCount === 0}
              onClick={() => void handleBulkGenerate()}
            >
              {running
                ? `${aiWorkflowVersionLabel(workflowVersion)} 生成中 ${stats.completed}/${stats.total}`
                : stats.completed
                  ? `继续生成未完成的 ${remainingCount} 张`
                  : `生成 ${generationItems.length * candidateCount} 张候选`}
            </button>
            <button
              className="ai-recover-existing"
              disabled={controlsDisabled || !generationItems.length}
              onClick={() => void handleRecoverExisting()}
            >{recovering ? "正在恢复……" : "恢复已有候选（不生成）"}</button>
            {stats.unknown ? (
              <button
                className="ai-abandon-unknown"
                disabled={controlsDisabled}
                onClick={handleAbandonUnknowns}
              >确认放弃 {stats.unknown} 张待确认结果</button>
            ) : null}
          </div>

          <div className="ai-progress-card">
            <div><span>候选图片进度</span><strong>{stats.completed} / {stats.total} 张</strong></div>
            <progress value={stats.completed} max={Math.max(1, stats.total)} />
          </div>

          {activeGroups.length ? (
            <div className="ai-group-select">
              <select
                id="ai-group-select"
                aria-label="棋子链"
                value={selectedGroup?.id ?? ""}
                disabled={controlsDisabled}
                onChange={(event) => setSelectedGroupId(event.currentTarget.value)}
              >
                {activeGroups.map((group) => (
                  <option key={group.id} value={group.id}>{group.label}</option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="ai-matrix-shell">
            <div className="ai-matrix-viewport" ref={matrixViewportRef}>
              <div
                className="ai-matrix-content"
                ref={matrixContentRef}
                style={{ minWidth: `${matrixWidth}px` }}
              >
                <div className="ai-matrix-header">
                  <span>链节点</span><span>参考</span><span>候选</span>
                </div>
                <div className="ai-matrix-list">
                  {groupItems.map((item) => {
                    const psdReference = psdReferencesByAssetCode.get(item.assetCode);
                    const excelReference = selectedAiReferenceImage(item);
                    const thumbnail = psdReference
                      ? psdThumbnails[psdReferenceKey(psdReference)]
                      : excelReference ? thumbnails[excelReference.anchor.archiveEntry] : undefined;
                    const state = states[item.key];
                    const active = selectedItem?.key === item.key;
                    return (
                      <div
                        className={`ai-matrix-row ${active ? "is-active" : ""}`}
                        key={item.key}
                        onClick={() => setSelectedItemKey(item.key)}
                      >
                        <div className="ai-node-copy">
                          <span><strong>{item.name || item.assetCode}</strong><small>{item.assetCode}</small></span>
                        </div>
                        <ReferencePreview
                          item={item}
                          thumbnail={thumbnail}
                          hasReference={Boolean(psdReference || excelReference)}
                          onError={() => {
                            if (psdReference) {
                              const key = psdReferenceKey(psdReference);
                              psdThumbnailResourcesRef.current.get(key)?.revoke();
                              psdThumbnailResourcesRef.current.delete(key);
                              setPsdThumbnails((current) => ({
                                ...current,
                                [key]: { state: "error" }
                              }));
                              onStatus(`当前 PSD 参考图 ${item.assetCode} 的 ImageBlob 无法显示。`, "warn");
                              return;
                            }
                            if (excelReference) onThumbnailError(excelReference.anchor.archiveEntry);
                          }}
                        />
                        {psdReference?.targetIssue === "ambiguous" ? (
                          <div className="ai-candidate-unavailable">空白智能对象不唯一</div>
                        ) : (
                          <CandidateStrip
                            candidates={state?.candidates}
                            individualGenerationEnabled={workflowVersion === "flux"}
                            generationDisabled={controlsDisabled}
                            backfillDisabled={backfillDisabled}
                            noReferenceLabel={
                              workflowVersion === "flux"
                                ? "无参考图，无法运行 QwenVL"
                                : "当前 PSD 无对应节点"
                            }
                            onPreviewState={reportPreviewState}
                            onAccept={(candidate) => void handleAccept(item, candidate)}
                            onRegenerate={(slotIndex) => void handleRegenerate(item, slotIndex)}
                          />
                        )}
                      </div>
                    );
                  })}
                  {!groupItems.length ? (
                    <div className="ai-empty">当前 PSD 未识别到带参考图的物品画板。</div>
                  ) : null}
                </div>
              </div>
            </div>
            <div className="ai-matrix-horizontal-scroll" ref={matrixScrollbarRef}>
              <div className="ai-matrix-horizontal-spacer" style={{ width: `${matrixWidth}px` }} />
            </div>
          </div>

          {selectedItem ? (
            <div className="ai-prompt-editor ai-prompt-editor-bottom">
              <div className="ai-prompt-textarea-shell">
                <textarea
                  ref={promptTextareaRef}
                  value={promptDraft}
                  style={{ height: `${promptEditorHeight}px` }}
                  placeholder={promptSource?.detail ?? "生成或恢复候选后，可在这里修改当前物品描述。"}
                  aria-label={`${selectedItem.name || selectedItem.assetCode} 的可编辑 AI 生成描述`}
                  onChange={(event) => setPromptDraft(event.currentTarget.value)}
                />
                <span
                  className="ai-prompt-resize-handle"
                  role="separator"
                  aria-label="上下拖动调整提示词框高度"
                  aria-orientation="horizontal"
                  onMouseDown={startPromptResize}
                />
              </div>
              <button
                className="primary ai-regenerate-selected"
                disabled={
                  promptRegenerationDisabled ||
                  !generationItems.some((item) => item.key === selectedItem.key) || !promptDraft.trim()
                }
                onClick={() => void handleRegenerateSelected()}
              >{workflowVersion === "gpt-image-2" ? "重新生成选中链" : "重新生成选中物品"}</button>
            </div>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function ReferencePreview({
  item,
  thumbnail,
  hasReference,
  onError
}: {
  item: AssetCandidate;
  thumbnail?: ThumbnailRecord;
  hasReference: boolean;
  onError: () => void;
}): React.ReactElement {
  return (
    <span className="ai-reference-preview">
      {thumbnail?.state === "ready" && thumbnail.url
        ? <img src={thumbnail.url} alt={`${item.name || item.assetCode} 参考图`} onError={onError} />
        : <small>{thumbnail?.state === "loading" ? "加载中" : hasReference ? "未预览" : "无图片"}</small>}
    </span>
  );
}

function CandidateStrip({
  candidates,
  individualGenerationEnabled,
  generationDisabled,
  backfillDisabled,
  noReferenceLabel,
  onPreviewState,
  onAccept,
  onRegenerate
}: {
  candidates?: AiCandidateSlot[];
  individualGenerationEnabled: boolean;
  generationDisabled: boolean;
  backfillDisabled: boolean;
  noReferenceLabel: string;
  onPreviewState: (state: CandidatePreviewState, detail?: string) => void;
  onAccept: (candidate: AiCandidateSlot) => void;
  onRegenerate: (slotIndex: number) => void;
}): React.ReactElement {
  const [rootRef, visible] = useNearViewport<HTMLDivElement>(true);

  return (
    <div className="ai-candidate-strip" ref={rootRef}>
      {candidates?.map((candidate, slotIndex) => (
        <span className="ai-candidate-slot" key={candidate.id}>
          {visible && candidate.image?.preview
            ? <ImageBlobCandidatePreview
                key={`${candidate.id}:${candidate.image.filename}`}
                preview={candidate.image.preview}
                onPreviewState={onPreviewState}
              />
            : null}
          <CandidateCell
            candidate={candidate}
            individualGenerationEnabled={individualGenerationEnabled}
            generationDisabled={generationDisabled}
            backfillDisabled={backfillDisabled}
            onAccept={() => onAccept(candidate)}
            onRegenerate={() => onRegenerate(slotIndex)}
          />
        </span>
      ))}
      {!candidates ? <small className="ai-no-reference">{noReferenceLabel}</small> : null}
    </div>
  );
}

function CandidateCell({
  candidate,
  individualGenerationEnabled,
  generationDisabled,
  backfillDisabled,
  onAccept,
  onRegenerate
}: {
  candidate: AiCandidateSlot;
  individualGenerationEnabled: boolean;
  generationDisabled: boolean;
  backfillDisabled: boolean;
  onAccept: () => void;
  onRegenerate: () => void;
}): React.ReactElement {
  const action = aiCandidateAction(candidate);
  const interactive = action === "backfill";
  const preview = candidate.image?.preview;
  const actionDisabled = action === "generate" && !individualGenerationEnabled
    ? true
    : isAiCandidateActionDisabled(candidate, generationDisabled, backfillDisabled);
  const actionable = !actionDisabled;
  const activate = (): void => {
    if (!actionable) return;
    if (action === "backfill") onAccept();
    else if (action === "generate") onRegenerate();
  };
  return (
    <button
      className={`ai-candidate-cell is-${candidate.status} ${actionable ? "is-actionable" : ""}`}
      disabled={actionDisabled}
      aria-label={candidate.status === "accepted" ? "重新插入当前画板预览候选" : interactive ? "插入画板预览候选" : candidateStatusLabel(candidate)}
      title={candidate.error || candidate.image?.previewError || (
        candidate.status === "accepted"
          ? "当前画板预览；点击可重新插入"
          : interactive
            ? "点击图片插入对应 Photoshop 画板预览"
            : individualGenerationEnabled
              ? "点击生成或重试"
              : "GPT Image 2 需要使用“重新生成选中链”生成整条链"
      )}
      onClick={(event) => {
        event.stopPropagation();
        activate();
      }}
    >
      {interactive
        ? preview ? null : <small className="ai-candidate-preview-fallback">预览失败</small>
        : <span className="ai-candidate-status">{candidateStatusLabel(candidate)}</span>}
    </button>
  );
}

function ImageBlobCandidatePreview({
  preview,
  onPreviewState
}: {
  preview: AiCandidatePreview;
  onPreviewState: (state: CandidatePreviewState, detail?: string) => void;
}): React.ReactElement {
  const [resource, setResource] = useState<HolopixImageBlobResource | null>(null);
  const [failure, setFailure] = useState("");

  useEffect(() => {
    let next: HolopixImageBlobResource | undefined;
    setResource(null);
    setFailure("");
    try {
      next = createHolopixImageBlobResource(preview);
      setResource(next);
      onPreviewState("ready", next.diagnostic);
    } catch (error) {
      const detail = toErrorMessage(error);
      console.error("Holopix ImageBlob 原始像素预览不可用。", error);
      onPreviewState("error", detail);
      setFailure(detail);
    }
    return () => next?.revoke();
  }, [onPreviewState, preview]);

  const handleImageError = (): void => {
    const detail = describeHolopixImageBlobFailure(
      "image-element",
      "原始像素 Object URL 无法由 UXP <img> 显示。",
      preview
    );
    console.error(detail);
    resource?.revoke();
    setResource(null);
    setFailure(detail);
    onPreviewState("error", detail);
  };

  return (
    <span className="ai-candidate-image-host">
      {failure
        ? <small className="ai-candidate-preview-fallback">ImageBlob 失败</small>
        : resource
          ? <img
              className="ai-candidate-image"
              src={resource.url}
              width={AI_CANDIDATE_PREVIEW_SIZE}
              height={AI_CANDIDATE_PREVIEW_SIZE}
              draggable={false}
              alt=""
              aria-hidden="true"
              onError={handleImageError}
            />
          : null}
    </span>
  );
}

function useNearViewport<T extends Element>(
  retainOnceVisible = false
): [React.MutableRefObject<T | null>, boolean] {
  const rootRef = useRef<T | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const element = rootRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      const intersects = entries.some((entry) => entry.isIntersecting);
      setVisible((current) => retainOnceVisible ? current || intersects : intersects);
    }, { root: null, rootMargin: "140px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [retainOnceVisible]);

  return [rootRef, visible];
}

async function runItemGeneration(
  workbook: ImportedWorkbook | null,
  item: AssetCandidate,
  candidateCount: number,
  signal: AbortSignal,
  onStage: (message: string) => void,
  promptText?: string,
  psdReference?: PsdAiReference,
  onBatchCompleted?: (
    images: AiGeneratedImage[],
    completedBeforeBatch: number,
    totalCandidates: number,
    submission: HolopixCompletedBatchSubmission
  ) => void,
  onBeforeBatchSubmit?: (
    completedCandidates: number,
    totalCandidates: number
  ) => void | Promise<void>,
  onSubmissionLifecycle?: (event: HolopixSubmissionLifecycleEvent) => void
) {
  const suppliedPromptText = promptText?.trim();
  if (suppliedPromptText) {
    return generateHolopixImages({
      promptText: suppliedPromptText,
      candidateCount,
      assetCode: item.assetCode,
      signal,
      onStage,
      onBatchCompleted,
      onBeforeBatchSubmit,
      onSubmissionLifecycle
    });
  }
  if (psdReference) {
    onStage("正在只读提取当前 PSD 画板中的参考图；不会修改文档。");
    const referenceBytes = await readPsdAiReferenceJpeg(psdReference);
    return generateHolopixImages({
      referenceBytes,
      referenceFileName: `chess-go-psd-${safeFilePart(item.assetCode)}-${Date.now()}.jpg`,
      referenceMediaType: "image/jpeg",
      itemName: item.name?.trim() || item.assetCode,
      candidateCount,
      assetCode: item.assetCode,
      signal,
      onStage,
      onBatchCompleted,
      onBeforeBatchSubmit,
      onSubmissionLifecycle
    });
  }
  if (!workbook) throw new Error("当前 PSD 没有可读取的参考图，且尚未重新打开 Excel。");
  const reference = selectedAiReferenceImage(item);
  if (!reference) throw new Error("Excel 中没有可用于 QwenVL 提示词生成的参考图。");
  const referenceBytes = await workbook.reader.archive.readBinary(reference.anchor.archiveEntry);
  const extension = reference.anchor.mediaType === "jpeg"
    ? "jpg"
    : reference.anchor.mediaType === "png"
      ? "png"
      : "bin";
  const mediaType = reference.anchor.mediaType === "jpeg"
    ? "image/jpeg"
    : reference.anchor.mediaType === "png"
      ? "image/png"
      : "application/octet-stream";
  return generateHolopixImages({
    referenceBytes,
    referenceFileName: `chess-go-${safeFilePart(item.assetCode)}-${Date.now()}.${extension}`,
    referenceMediaType: mediaType,
    itemName: item.name?.trim() || item.assetCode,
    candidateCount,
    assetCode: item.assetCode,
    signal,
    onStage,
    onBatchCompleted,
    onBeforeBatchSubmit,
    onSubmissionLifecycle
  });
}

function recordSubmissionLifecycle(
  job: QueuedFluxGenerationJob,
  event: HolopixSubmissionLifecycleEvent
): void {
  const reference = job.psdReference;
  if (!reference) return;
  if (event.state === "resolved" && event.outcome !== "output") {
    if (!removeHolopixPendingSubmissions([event.submissionKey])) {
      throw new Error("无法清除已结束的本地提交记录。");
    }
    return;
  }
  const saved = saveHolopixPendingSubmission({
    version: 2,
    documentId: reference.documentId,
    documentName: reference.documentName,
    documentIdentity: reference.documentIdentity,
    assetCode: reference.assetCode,
    artboardId: reference.artboardId,
    referenceLayerId: reference.referenceLayerId,
    ...(reference.targetLayerId === undefined ? {} : { targetLayerId: reference.targetLayerId }),
    ...(reference.targetIssue ? { targetIssue: reference.targetIssue } : {}),
    workflowVersion: "flux",
    slotCount: event.batchSize,
    submissionKey: event.submissionKey,
    ...(event.promptId ? { promptId: event.promptId } : {}),
    ...((event.promptText?.trim() || job.promptText?.trim())
      ? { promptText: event.promptText?.trim() || job.promptText!.trim() }
      : {}),
    outcome: event.state === "resolved" && event.outcome === "output" ? "output" : "pending",
    ...(event.images?.length ? { images: persistableHolopixImages(event.images) } : {}),
    createdAt: event.createdAt
  });
  if (!saved) throw new Error("无法写入本地待确认提交记录。");
}

function recordGptImage2SubmissionLifecycle(
  job: QueuedGptImage2GenerationJob,
  event: HolopixSubmissionLifecycleEvent
): void {
  const records = job.entries.map((entry) => {
    const reference = entry.psdReference;
    const submissionKey = gptImage2ItemSubmissionKey(event.submissionKey, entry.item.assetCode);
    const images = event.images?.filter((image) => gptImage2ImageMatchesAssetCode(
      image.filename,
      entry.item.assetCode
    ));
    const promptText = entry.promptText?.trim()
      || entry.item.name?.trim()
      || entry.item.assetCode;
    return {
      version: 2 as const,
      documentId: reference.documentId,
      documentName: reference.documentName,
      documentIdentity: reference.documentIdentity,
      assetCode: reference.assetCode,
      artboardId: reference.artboardId,
      referenceLayerId: reference.referenceLayerId,
      ...(reference.targetLayerId === undefined ? {} : { targetLayerId: reference.targetLayerId }),
      ...(reference.targetIssue ? { targetIssue: reference.targetIssue } : {}),
      workflowVersion: "gpt-image-2" as const,
      slotCount: 1,
      submissionKey,
      ...(event.promptId ? { promptId: event.promptId } : {}),
      ...(promptText ? { promptText } : {}),
      outcome: event.state === "resolved" && event.outcome === "output" ? "output" as const : "pending" as const,
      ...(images?.length ? { images: persistableHolopixImages(images) } : {}),
      createdAt: event.createdAt
    };
  });
  const keys = records.map((record) => record.submissionKey);
  if (event.state === "resolved" && event.outcome !== "output") {
    if (!removeHolopixPendingSubmissions(keys)) {
      throw new Error("无法清除已结束的 GPT Image 2 本地提交记录。");
    }
    return;
  }
  const recordsToSave = event.state === "resolved" && event.outcome === "output"
    ? records.filter((record) => "images" in record && Boolean(record.images?.length))
    : records;
  if (recordsToSave.length !== records.length) {
    const missingKeys = records
      .filter((record) => !("images" in record) || !record.images?.length)
      .map((record) => record.submissionKey);
    if (!removeHolopixPendingSubmissions(missingKeys)) {
      throw new Error("无法清除未返回图片的 GPT Image 2 本地提交记录。");
    }
  }
  const savedKeys: string[] = [];
  for (const record of recordsToSave) {
    if (saveHolopixPendingSubmission(record)) {
      savedKeys.push(record.submissionKey);
      continue;
    }
    removeHolopixPendingSubmissions(savedKeys);
    throw new Error(
      event.state === "started"
        ? "无法写入 GPT Image 2 本地待确认提交记录；整链请求未发送。"
        : "无法更新 GPT Image 2 本地提交记录。"
    );
  }
}

function pendingSubmissionMatchesReference(
  pending: HolopixPendingSubmissionRecord,
  reference: GeneratablePsdReference,
  workflowVersion: AiWorkflowVersion = "flux"
): boolean {
  return holopixPendingSubmissionMatchesScope(pending, { ...reference, workflowVersion });
}

function psdReferenceKey(reference: PsdAiReference): string {
  return `${reference.documentId}:${reference.referenceLayerId}`;
}

function psdGenerationScopeKey(reference: Pick<
  PsdAiReference,
  "documentId" | "documentIdentity" | "assetCode" | "artboardId" | "referenceLayerId"
>): string {
  return [
    reference.documentId,
    reference.documentIdentity,
    reference.assetCode,
    reference.artboardId,
    reference.referenceLayerId
  ].join(":");
}

async function assertActivePsdGenerationScope(reference: GeneratablePsdReference): Promise<void> {
  if (!isStablePsdDocumentIdentity(reference.documentIdentity)) {
    throw new Error("当前 PSD 尚未保存或无法取得稳定文件路径；为避免重复付费，请先保存 PSD 再生成。");
  }
  const current = await inspectActiveReferenceDocument();
  const expectedKey = psdGenerationScopeKey(reference);
  if (
    current?.documentId !== reference.documentId
    || current.documentIdentity !== reference.documentIdentity
    || !current.aiNodes.filter(isGeneratableReference).some((node) => psdGenerationScopeKey({
        ...node,
        documentId: current.documentId,
        documentIdentity: current.documentIdentity
      }) === expectedKey)
  ) {
    throw new Error("当前 PSD 或节点结构已经变化；Holopix 批次未提交。");
  }
}

function isGeneratableReference<T extends { targetLayerId?: number; targetIssue?: "missing" | "ambiguous" }>(
  reference: T
): reference is T & (
  | { targetLayerId: number; targetIssue?: undefined }
  | { targetLayerId?: undefined; targetIssue: "missing" }
) {
  return Number.isInteger(reference.targetLayerId) || reference.targetIssue === "missing";
}

function safeFilePart(value: string): string {
  return value.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 60) || "reference";
}

function markSlots(
  current: Record<string, AiItemState>,
  jobs: Array<{ item: AssetCandidate; slotIndexes: number[] }>,
  status: AiCandidateSlot["status"]
): Record<string, AiItemState> {
  let next = current;
  for (const job of jobs) {
    next = updateSlotIndexes(next, job.item.key, job.slotIndexes, (slot) => ({ ...slot, status, error: undefined }));
  }
  return next;
}

function updateGptImage2Entries(
  current: Record<string, AiItemState>,
  entries: QueuedGptImage2Entry[],
  update: (slot: AiCandidateSlot, entry: QueuedGptImage2Entry) => AiCandidateSlot
): Record<string, AiItemState> {
  let next = current;
  for (const entry of entries) {
    next = updateSlotIndexes(next, entry.item.key, [entry.slotIndex], (slot) => update(slot, entry));
  }
  return next;
}

function failGptImage2Entries(
  current: Record<string, AiItemState>,
  entries: QueuedGptImage2Entry[],
  error: string
): Record<string, AiItemState> {
  return updateGptImage2Entries(current, entries, (slot, entry) => ({
    ...slot,
    status: "failed",
    error,
    retryPromptText: entry.promptText?.trim() || slot.retryPromptText
  }));
}

function markGptImage2EntriesUnknown(
  current: Record<string, AiItemState>,
  entries: QueuedGptImage2Entry[],
  error: string,
  promptId?: string,
  sharedSubmissionKey?: string
): Record<string, AiItemState> {
  return updateGptImage2Entries(current, entries, (slot, entry) => ({
    ...slot,
    status: "unknown",
    error,
    retryPromptText: entry.promptText?.trim() || slot.retryPromptText,
    ...(promptId ? { submissionPromptId: promptId } : {}),
    ...(sharedSubmissionKey ? {
      submissionKey: gptImage2ItemSubmissionKey(sharedSubmissionKey, entry.item.assetCode)
    } : {})
  }));
}

function gptImage2ItemSubmissionKey(sharedKey: string, assetCode: string): string {
  return `${sharedKey}:${safeGptImage2OutputName(assetCode)}`;
}

function gptImage2ImageMatchesAssetCode(filename: string, assetCode: string): boolean {
  const safeName = safeGptImage2OutputName(assetCode).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${safeName}(?:__run\\d+)?\\.png$`, "i").test(filename);
}

function updateSlotIndexes(
  current: Record<string, AiItemState>,
  itemKey: string,
  slotIndexes: number[],
  update: (slot: AiCandidateSlot, offset: number) => AiCandidateSlot
): Record<string, AiItemState> {
  const state = current[itemKey];
  if (!state) return current;
  const offsetByIndex = new Map(slotIndexes.map((slotIndex, offset) => [slotIndex, offset]));
  return {
    ...current,
    [itemKey]: {
      ...state,
      candidates: state.candidates.map((slot, index) => {
        const offset = offsetByIndex.get(index);
        return offset === undefined ? slot : update(slot, offset);
      })
    }
  };
}

function candidateStatusLabel(candidate: AiCandidateSlot): string {
  if (candidate.status === "idle") return "待生成";
  if (candidate.status === "queued") return "排队中";
  if (candidate.status === "generating") return "生成中";
  if (candidate.status === "ready") return "可选择";
  if (candidate.status === "accepted") return "已选";
  if (candidate.status === "unknown") return "结果待确认";
  return "失败 · 重试";
}
