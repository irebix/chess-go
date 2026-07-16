import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AssetCandidate, SheetGroup } from "../domain/models";
import {
  acceptAiCandidate,
  aiCandidateAction,
  appendAiCandidateSlots,
  isAiCandidateActionDisabled,
  reconcileAiItemStates,
  selectedAiReferenceImage,
  summarizeAiCandidates,
  type AiCandidatePreview,
  type AiCandidateSlot,
  type AiItemState
} from "../domain/aiCandidates";
import {
  aiCandidateMatrixWidth,
  shouldForwardMatrixWheel
} from "../domain/aiMatrixLayout";
import { filterItemsByGroups } from "../domain/sheetGroups";
import type { ImportedWorkbook } from "../services/WorkbookService";
import {
  generateHolopixImages,
  loadHolopixPromptSource,
  recoverRecentHolopixImages
} from "../ai/holopixClient";
import {
  createHolopixImageBlobResource,
  type HolopixImageBlobResource
} from "../ai/holopixImageBlob";
import {
  buildHolopixCanvasStripRuns,
  holopixCanvasStripWidth,
  HOLOPIX_CANVAS_PREVIEW_SIZE
} from "../ai/holopixSafePreview";
import type { HolopixPromptSource } from "../ai/holopixWorkflow";
import { backfillAiCandidate } from "../photoshop/aiCandidateBackfill";
import {
  readPsdAiReferencePreview,
  readPsdAiReferenceJpeg,
  type PsdAiReference
} from "../photoshop/psdAiReference";
import { toErrorMessage } from "../utils/errors";

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
}

type CandidatePreviewMode = "imageblob" | "canvas";
const mountedCanvasRedraws = new Set<() => void>();

interface QueuedGenerationJob {
  workbook: ImportedWorkbook | null;
  item: AssetCandidate;
  slotIndexes: number[];
  psdReference?: PsdAiReference;
  promptText?: string;
  successMessage?: string;
  failurePrefix: string;
  onSettled?: (success: boolean) => void;
}

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
  onBusyChange
}: AiGenerationPanelProps): React.ReactElement {
  const [open, setOpen] = useState(true);
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
  const generationQueueRef = useRef<QueuedGenerationJob[]>([]);
  const queueProcessingRef = useRef(false);
  const psdThumbnailRequestsRef = useRef(new Set<string>());
  const psdThumbnailQueueRef = useRef(Promise.resolve());
  const psdThumbnailResourcesRef = useRef(new Map<string, HolopixImageBlobResource>());
  const promptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
  const promptResizeCleanupRef = useRef<(() => void) | null>(null);
  const matrixContentRef = useRef<HTMLDivElement | null>(null);
  const matrixScrollbarRef = useRef<HTMLDivElement | null>(null);
  const previewModeReportedRef = useRef({ imageblob: false, canvas: false });
  const reportPreviewMode = useCallback((mode: CandidatePreviewMode, detail?: string): void => {
    if (previewModeReportedRef.current[mode]) return;
    previewModeReportedRef.current[mode] = true;
    if (mode === "imageblob") {
      onStatus("Holopix 候选预览：ImageBlob 原始 RGBA 高清模式已加载。");
      return;
    }
    onStatus(`Holopix 候选预览：ImageBlob 不可用，已回退 Canvas${detail ? `：${detail}` : "。"}`, "warn");
  }, [onStatus]);
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
    setStates(next);
  }, []);
  useCanvasRedrawScheduler(open);

  const selectedGroup = activeGroups.find((group) => group.id === selectedGroupId) ?? activeGroups[0];
  const groupItems = useMemo(
    () => selectedGroup ? filterItemsByGroups(items, [selectedGroup]) : [],
    [items, selectedGroup]
  );
  const psdReferencesByAssetCode = useMemo(
    () => new Map(psdReferences.map((reference) => [reference.assetCode, reference])),
    [psdReferences]
  );
  const generationItems = useMemo(
    () => groupItems.filter((item) => (
      psdReferencesByAssetCode.has(item.assetCode) || Boolean(selectedAiReferenceImage(item))
    )),
    [groupItems, psdReferencesByAssetCode]
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
      ?.image?.promptText?.trim() ?? "";
  }, [selectedItem, states]);
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
    updateStates((current) => reconcileAiItemStates(current, generationItems, candidateCount));
  }, [candidateCount, generationItems, running, updateStates]);

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
    const matrixContent = matrixContentRef.current;
    const matrixScrollbar = matrixScrollbarRef.current;
    if (!matrixContent || !matrixScrollbar) return;
    const syncHorizontalPosition = (): void => {
      matrixContent.style.transform = `translateX(${-matrixScrollbar.scrollLeft}px)`;
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
    const maximumScrollLeft = Math.max(0, matrixWidth - matrixScrollbar.clientWidth);
    matrixScrollbar.scrollLeft = Math.min(matrixScrollbar.scrollLeft, maximumScrollLeft);
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
  }, [selectedItem?.assetCode, selectedItem?.name]);

  useEffect(() => {
    onBusyChange(running || recovering || Boolean(syncingCandidateId));
    return () => onBusyChange(false);
  }, [onBusyChange, recovering, running, syncingCandidateId]);

  async function handleRecoverExisting(): Promise<void> {
    if (!selectedGroup || controlsDisabled || !generationItems.length) return;
    setRecovering(true);
    try {
      const recovered = await recoverRecentHolopixImages(
        generationItems.map((item) => item.assetCode),
        candidateCount,
        undefined,
        (message) => onStatus(`Holopix 安全预览：${message}`)
      );
      const recoveredCount = generationItems.reduce(
        (count, item) => count + Math.min(candidateCount, recovered[item.assetCode]?.length ?? 0),
        0
      );
      updateStates((current) => {
        const next = reconcileAiItemStates(current, generationItems, candidateCount);
        for (const item of generationItems) {
          const images = recovered[item.assetCode] ?? [];
          const state = next[item.key];
          if (!state || !images.length) continue;
          next[item.key] = {
            ...state,
            candidates: state.candidates.map((candidate, index) => {
              const image = images[index];
              if (!image) return candidate;
              return {
                ...candidate,
                status: candidate.status === "accepted" ? "accepted" : "ready",
                image,
                error: undefined
              };
            })
          };
        }
        return { ...next };
      });
      const detail = recoveredCount
        ? `已从 ComfyUI 历史恢复 ${recoveredCount} 张候选；未提交新生成任务。`
        : "ComfyUI 历史中没有找到当前棋子链的已有候选。";
      onStatus(detail, recoveredCount ? "info" : "warn");
    } catch (error) {
      const detail = `恢复已有候选失败：${toErrorMessage(error)}`;
      onStatus(detail, "error");
    } finally {
      setRecovering(false);
    }
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
        const controller = new AbortController();
        abortRef.current = controller;
        let success = false;
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
            job.psdReference
          );
          updateStates((current) => updateSlotIndexes(
            current,
            job.item.key,
            job.slotIndexes,
            (slot, offset) => ({
              ...slot,
              status: "ready",
              image: images[offset]!,
              error: undefined
            })
          ));
          success = true;
          if (job.successMessage) onStatus(job.successMessage);
        } catch (error) {
          const detail = toErrorMessage(error);
          updateStates((current) => updateSlotIndexes(
            current,
            job.item.key,
            job.slotIndexes,
            (slot) => ({ ...slot, status: "failed", error: detail })
          ));
          onStatus(`${job.failurePrefix}：${detail}`, "error");
        } finally {
          if (abortRef.current === controller) abortRef.current = null;
          job.onSettled?.(success);
        }
      }
    } finally {
      queueProcessingRef.current = false;
      setRunning(false);
    }
  }

  async function handleBulkGenerate(): Promise<void> {
    if (!selectedGroup || running) return;
    const snapshot = reconcileAiItemStates(statesRef.current, generationItems, candidateCount);
    const jobs = generationItems.flatMap((item) => {
      const state = snapshot[item.key];
      if (!state) return [];
      const slotIndexes = state.candidates.flatMap((candidate, index) =>
        candidate.status === "idle" || candidate.status === "failed" ? [index] : []
      );
      return chunkCandidateSlotIndexes(slotIndexes).map((chunk) => ({ item, slotIndexes: chunk }));
    });
    const totalCandidates = jobs.reduce((count, job) => count + job.slotIndexes.length, 0);
    if (!totalCandidates) {
      onStatus("当前棋子链没有待生成或失败的候选。", "warn");
      return;
    }
    updateStates(() => markSlots(snapshot, jobs, "queued"));
    onStatus(`Holopix 批量生成开始：${jobs.length} 项，${totalCandidates} 张候选。`);

    let completedJobs = 0;
    let failedJobs = 0;
    for (const job of jobs) {
      enqueueGeneration({
        workbook,
        item: job.item,
        slotIndexes: job.slotIndexes,
        psdReference: psdReferencesByAssetCode.get(job.item.assetCode),
        failurePrefix: `Holopix ${job.item.assetCode} 生成失败`,
        onSettled: (success) => {
          if (!success) failedJobs += 1;
          completedJobs += 1;
          onStatus(`Holopix 批次进度 ${completedJobs}/${jobs.length}${failedJobs ? `；失败 ${failedJobs}` : ""}。`);
          if (completedJobs === jobs.length) {
            const detail = failedJobs
              ? `Holopix 批量结束：${jobs.length - failedJobs} 项成功，${failedJobs} 项失败，可点击失败格重试。`
              : `Holopix 批量完成：${jobs.length} 项，共 ${totalCandidates} 张候选。`;
            onStatus(detail, failedJobs ? "warn" : "info");
          }
        }
      });
    }
  }

  async function handleRegenerate(item: AssetCandidate, slotIndex: number): Promise<void> {
    if (controlsDisabled) return;
    const state = statesRef.current[item.key];
    if (!state) return;
    setSelectedItemKey(item.key);
    updateStates((current) => updateSlotIndexes(current, item.key, [slotIndex], (slot) => ({
      ...slot,
      status: "queued",
      error: undefined
    })));
    enqueueGeneration({
      workbook,
      item,
      slotIndexes: [slotIndex],
      psdReference: psdReferencesByAssetCode.get(item.assetCode),
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
    const state = snapshot[item.key];
    if (!state) return;
    const appendedState = appendAiCandidateSlots(state, candidateCount);
    const slotIndexes = Array.from(
      { length: appendedState.candidates.length - state.candidates.length },
      (_, offset) => state.candidates.length + offset
    );
    updateStates(() => ({ ...snapshot, [item.key]: appendedState }));
    onStatus(`Holopix ${item.assetCode} 已追加 ${slotIndexes.length} 张候选，正在安全单队列中等待生成。`);
    enqueueGeneration({
      workbook,
      item,
      slotIndexes,
      promptText,
      psdReference: psdReferencesByAssetCode.get(item.assetCode),
      successMessage: `Holopix 已用修改后的提示词生成新增候选：${item.assetCode}。`,
      failurePrefix: `Holopix ${item.assetCode} 新增候选生成失败`
    });
  }

  async function handleAccept(item: AssetCandidate, candidate: AiCandidateSlot): Promise<void> {
    if (!candidate.image || backfillDisabled) return;
    const geometryAudit: string[] = [];
    setSelectedItemKey(item.key);
    setSyncingCandidateId(candidate.id);
    try {
      const result = await backfillAiCandidate(
        item.assetCode,
        candidate.image.url,
        (message) => geometryAudit.push(message)
      );
      updateStates((current) => {
        const state = current[item.key];
        return state ? { ...current, [item.key]: acceptAiCandidate(state, candidate.id) } : current;
      });
      const detail = result.applied
        ? `${result.detail} 可继续点击同一行的其他候选，在画板中直接对比。`
        : result.detail;
      onStatus(detail, result.applied ? "info" : "warn");
    } catch (error) {
      const detail = `候选已选中，但回填 PSD 失败：${toErrorMessage(error)}`;
      onStatus(detail, "error");
    } finally {
      for (const message of geometryAudit) onStatus(`回填几何 ${item.assetCode}：${message}`);
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
                ? `生成中 ${stats.completed}/${stats.total}`
                : stats.completed
                  ? `继续生成未完成的 ${remainingCount} 张`
                  : `生成 ${generationItems.length * candidateCount} 张候选`}
            </button>
            <button
              className="ai-recover-existing"
              disabled={controlsDisabled || !generationItems.length}
              onClick={() => void handleRecoverExisting()}
            >{recovering ? "正在恢复……" : "恢复已有候选（不生成）"}</button>
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
            <div className="ai-matrix-viewport">
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
                        <CandidateStrip
                          candidates={state?.candidates}
                          generationDisabled={controlsDisabled}
                          backfillDisabled={backfillDisabled}
                          onPreviewMode={reportPreviewMode}
                          onAccept={(candidate) => void handleAccept(item, candidate)}
                          onRegenerate={(slotIndex) => void handleRegenerate(item, slotIndex)}
                        />
                      </div>
                    );
                  })}
                  {!groupItems.length ? (
                    <div className="ai-empty">当前 PSD 未识别到同时包含参考图和唯一空白智能对象的画板。</div>
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
                  placeholder={promptSource?.detail ?? "生成或恢复候选后，可在这里修改 Holopix 实际提示词。"}
                  aria-label={`${selectedItem.name || selectedItem.assetCode} 的可编辑 Holopix 提示词`}
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
              >重新生成选中物品</button>
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
  generationDisabled,
  backfillDisabled,
  onPreviewMode,
  onAccept,
  onRegenerate
}: {
  candidates?: AiCandidateSlot[];
  generationDisabled: boolean;
  backfillDisabled: boolean;
  onPreviewMode: (mode: CandidatePreviewMode, detail?: string) => void;
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
                onPreviewMode={onPreviewMode}
              />
            : null}
          <CandidateCell
            candidate={candidate}
            generationDisabled={generationDisabled}
            backfillDisabled={backfillDisabled}
            onAccept={() => onAccept(candidate)}
            onRegenerate={() => onRegenerate(slotIndex)}
          />
        </span>
      ))}
      {!candidates ? <small className="ai-no-reference">无参考图，无法运行 QwenVL</small> : null}
    </div>
  );
}

function CandidateCell({
  candidate,
  generationDisabled,
  backfillDisabled,
  onAccept,
  onRegenerate
}: {
  candidate: AiCandidateSlot;
  generationDisabled: boolean;
  backfillDisabled: boolean;
  onAccept: () => void;
  onRegenerate: () => void;
}): React.ReactElement {
  const action = aiCandidateAction(candidate);
  const interactive = action === "backfill";
  const preview = candidate.image?.preview;
  const actionDisabled = isAiCandidateActionDisabled(
    candidate,
    generationDisabled,
    backfillDisabled
  );
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
            : "点击生成或重试"
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
  onPreviewMode
}: {
  preview: AiCandidatePreview;
  onPreviewMode: (mode: CandidatePreviewMode, detail?: string) => void;
}): React.ReactElement {
  const [resource, setResource] = useState<HolopixImageBlobResource | null>(null);
  const [imageFailed, setImageFailed] = useState(false);
  const fallbackPreviews = useMemo(() => [preview], [preview]);

  useEffect(() => {
    let next: HolopixImageBlobResource | undefined;
    setResource(null);
    setImageFailed(false);
    try {
      next = createHolopixImageBlobResource(preview);
      setResource(next);
      onPreviewMode("imageblob");
    } catch (error) {
      console.warn("Holopix ImageBlob 原始像素预览不可用，回退 Canvas。", error);
      onPreviewMode("canvas", toErrorMessage(error));
      setImageFailed(true);
    }
    return () => next?.revoke();
  }, [onPreviewMode, preview]);

  const fallbackToCanvas = (): void => {
    resource?.revoke();
    setResource(null);
    setImageFailed(true);
    onPreviewMode("canvas", "原始像素 Object URL 无法由 UXP <img> 显示。");
  };

  return (
    <span className="ai-candidate-image-host">
      {imageFailed
        ? <CandidateCanvasSurface previews={fallbackPreviews} className="ai-candidate-preview-canvas" />
        : resource
          ? <img
              className="ai-candidate-image"
              src={resource.url}
              width={HOLOPIX_CANVAS_PREVIEW_SIZE}
              height={HOLOPIX_CANVAS_PREVIEW_SIZE}
              draggable={false}
              alt=""
              aria-hidden="true"
              onError={fallbackToCanvas}
            />
          : null}
    </span>
  );
}

function CandidateCanvasSurface({
  previews,
  className
}: {
  previews: Array<AiCandidatePreview | undefined>;
  className: string;
}): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [renderFailed, setRenderFailed] = useState(false);
  const runs = useMemo(() => buildHolopixCanvasStripRuns(previews), [previews]);
  const canvasWidth = holopixCanvasStripWidth(previews.length);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const context = canvas.getContext("2d");
      if (!context) throw new Error("当前 UXP 不支持 Canvas 2D 上下文。");
      context.clearRect(0, 0, canvasWidth, HOLOPIX_CANVAS_PREVIEW_SIZE);
      let fillColor = "";
      for (const run of runs) {
        if (run.color !== fillColor) {
          context.fillStyle = run.color;
          fillColor = run.color;
        }
        context.fillRect(run.x, run.y, run.width, run.height);
      }
      setRenderFailed(false);
    } catch (error) {
      console.error("Holopix Canvas 安全预览绘制失败", error);
      setRenderFailed(true);
    }
  }, [canvasWidth, runs]);

  useEffect(() => {
    draw();
    mountedCanvasRedraws.add(draw);
    return () => {
      mountedCanvasRedraws.delete(draw);
    };
  }, [draw]);

  if (renderFailed) return <small className="ai-candidate-preview-fallback">预览失败</small>;

  return (
    <canvas
      ref={canvasRef}
      className={className}
      width={canvasWidth}
      height={HOLOPIX_CANVAS_PREVIEW_SIZE}
      style={{ width: `${canvasWidth}px`, height: `${HOLOPIX_CANVAS_PREVIEW_SIZE}px` }}
      aria-label="Holopix 安全候选缩略图"
    />
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

function useCanvasRedrawScheduler(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let timer: number | undefined;
    const scheduleRedraw = (): void => {
      if (timer !== undefined) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = undefined;
        for (const redraw of Array.from(mountedCanvasRedraws)) redraw();
      }, 180);
    };
    document.addEventListener("scroll", scheduleRedraw, true);
    window.addEventListener("resize", scheduleRedraw);
    document.addEventListener("visibilitychange", scheduleRedraw);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
      document.removeEventListener("scroll", scheduleRedraw, true);
      window.removeEventListener("resize", scheduleRedraw);
      document.removeEventListener("visibilitychange", scheduleRedraw);
    };
  }, [enabled]);
}

async function runItemGeneration(
  workbook: ImportedWorkbook | null,
  item: AssetCandidate,
  candidateCount: number,
  signal: AbortSignal,
  onStage: (message: string) => void,
  promptText?: string,
  psdReference?: PsdAiReference
) {
  const suppliedPromptText = promptText?.trim();
  if (suppliedPromptText) {
    return generateHolopixImages({
      promptText: suppliedPromptText,
      candidateCount,
      assetCode: item.assetCode,
      signal,
      onStage
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
      onStage
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
    onStage
  });
}

function psdReferenceKey(reference: PsdAiReference): string {
  return `${reference.documentId}:${reference.referenceLayerId}`;
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

function chunkCandidateSlotIndexes(slotIndexes: number[]): number[][] {
  const chunks: number[][] = [];
  for (let index = 0; index < slotIndexes.length; index += 4) {
    chunks.push(slotIndexes.slice(index, index + 4));
  }
  return chunks;
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
  return "失败 · 重试";
}
