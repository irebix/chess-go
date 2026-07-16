import React, { useEffect, useMemo, useRef, useState } from "react";
import type { AssetCandidate, SheetGroup } from "../domain/models";
import {
  acceptAiCandidate,
  reconcileAiItemStates,
  summarizeAiCandidates,
  type AiCandidatePreview,
  type AiCandidateSlot,
  type AiItemState
} from "../domain/aiCandidates";
import { filterItemsByGroups } from "../domain/sheetGroups";
import type { ImportedWorkbook } from "../services/WorkbookService";
import {
  generateHolopixImages,
  loadHolopixPromptSource,
  recoverRecentHolopixImages
} from "../ai/holopixClient";
import { openHolopixCandidateExternally } from "../ai/holopixExternalPreview";
import {
  buildHolopixCanvasRuns,
  HOLOPIX_CANVAS_PREVIEW_SIZE
} from "../ai/holopixSafePreview";
import type { HolopixPromptSource } from "../ai/holopixWorkflow";
import { backfillAiCandidate } from "../photoshop/aiCandidateBackfill";
import { toErrorMessage } from "../utils/errors";

interface ThumbnailRecord {
  state: "loading" | "ready" | "error";
  url?: string;
}

interface AiGenerationPanelProps {
  workbook: ImportedWorkbook | null;
  activeGroups: SheetGroup[];
  items: AssetCandidate[];
  thumbnails: Record<string, ThumbnailRecord>;
  externalBusy: boolean;
  requestThumbnail: (entry: string) => void;
  onThumbnailError: (entry: string) => void;
  onStatus: (message: string, level?: "info" | "warn" | "error") => void;
  onBusyChange: (busy: boolean) => void;
}

type MatrixTab = "matrix" | "accepted";
const AI_GENERATION_CONCURRENCY = 1;

export function AiGenerationPanel({
  workbook,
  activeGroups,
  items,
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
  const [tab, setTab] = useState<MatrixTab>("matrix");
  const [running, setRunning] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [syncingCandidateId, setSyncingCandidateId] = useState<string | null>(null);
  const [openingCandidateId, setOpeningCandidateId] = useState<string | null>(null);
  const [promptSource, setPromptSource] = useState<HolopixPromptSource | null>(null);
  const [panelMessage, setPanelMessage] = useState("Excel 参考图只用于 Holopix 图生文，生成节点仅接收返回的文字提示词。");
  const abortRef = useRef<AbortController | null>(null);

  const selectedGroup = activeGroups.find((group) => group.id === selectedGroupId) ?? activeGroups[0];
  const groupItems = useMemo(
    () => selectedGroup ? filterItemsByGroups(items, [selectedGroup]) : [],
    [items, selectedGroup]
  );
  const generationItems = useMemo(
    () => groupItems.filter((item) => Boolean(selectedExcelImage(item))),
    [groupItems]
  );
  const itemStates = groupItems.flatMap((item) => states[item.key] ? [states[item.key]!] : []);
  const stats = summarizeAiCandidates(itemStates);
  const selectedItem = groupItems.find((item) => item.key === selectedItemKey) ?? groupItems[0];
  const runtimePromptTexts = useMemo(() => {
    if (!selectedItem) return [];
    const prompts = states[selectedItem.key]?.candidates.flatMap((candidate) => {
      const promptText = candidate.image?.promptText?.trim();
      return promptText ? [promptText] : [];
    }) ?? [];
    return Array.from(new Set(prompts));
  }, [selectedItem, states]);
  const disabled = externalBusy || running || recovering || Boolean(syncingCandidateId) || Boolean(openingCandidateId);
  const promptDisplay = runtimePromptTexts.length > 1
    ? runtimePromptTexts.map((prompt, index) => `批次 ${index + 1}\n${prompt}`).join("\n\n")
    : runtimePromptTexts[0] ?? promptSource?.detail ?? "正在读取工作流提示词来源……";
  const remainingCount = itemStates.reduce(
    (count, state) => count + state.candidates.filter(
      (candidate) => candidate.status === "idle" || candidate.status === "failed"
    ).length,
    0
  );

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
    setStates((current) => reconcileAiItemStates(current, generationItems, candidateCount));
    if (!groupItems.some((item) => item.key === selectedItemKey)) {
      setSelectedItemKey(groupItems[0]?.key ?? "");
    }
  }, [candidateCount, generationItems, groupItems, selectedItemKey]);

  useEffect(() => {
    for (const item of groupItems) {
      const image = selectedExcelImage(item);
      if (image && !thumbnails[image.anchor.archiveEntry]) requestThumbnail(image.anchor.archiveEntry);
    }
  }, [groupItems, requestThumbnail, thumbnails]);

  useEffect(() => () => abortRef.current?.abort(), []);

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
    onBusyChange(running || recovering || Boolean(syncingCandidateId) || Boolean(openingCandidateId));
    return () => onBusyChange(false);
  }, [onBusyChange, openingCandidateId, recovering, running, syncingCandidateId]);

  async function handleRecoverExisting(): Promise<void> {
    if (!selectedGroup || disabled || !generationItems.length) return;
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
      setStates((current) => {
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
      setPanelMessage(detail);
      onStatus(detail, recoveredCount ? "info" : "warn");
    } catch (error) {
      const detail = `恢复已有候选失败：${toErrorMessage(error)}`;
      setPanelMessage(detail);
      onStatus(detail, "error");
    } finally {
      setRecovering(false);
    }
  }

  async function handleBulkGenerate(): Promise<void> {
    if (!workbook || !selectedGroup || running) return;
    const snapshot = reconcileAiItemStates(states, generationItems, candidateCount);
    const jobs = generationItems.flatMap((item) => {
      const state = snapshot[item.key];
      if (!state) return [];
      const slotIndexes = state.candidates.flatMap((candidate, index) =>
        candidate.status === "idle" || candidate.status === "failed" ? [index] : []
      );
      return slotIndexes.length ? [{ item, slotIndexes }] : [];
    });
    const totalCandidates = jobs.reduce((count, job) => count + job.slotIndexes.length, 0);
    if (!totalCandidates) {
      setPanelMessage("当前棋子链没有待生成或失败的候选。");
      return;
    }
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setStates(markSlots(snapshot, jobs, "queued"));
    setPanelMessage(`将为 ${jobs.length} 个节点先执行参考图生文，再提交 ${totalCandidates} 张 1:1 文生图候选；使用安全单队列。`);
    onStatus(`Holopix 批量生成开始：${jobs.length} 项，${totalCandidates} 张候选。`);

    let completedJobs = 0;
    let failedJobs = 0;
    let nextJob = 0;
    const worker = async (): Promise<void> => {
      while (nextJob < jobs.length) {
        const job = jobs[nextJob++]!;
        try {
          onStatus(`Holopix ${job.item.assetCode} 开始生成 ${job.slotIndexes.length} 张候选。`);
          setStates((current) => updateSlotIndexes(current, job.item.key, job.slotIndexes, (slot) => ({
            ...slot,
            status: "generating",
            error: undefined
          })));
          const images = await runItemGeneration(
            workbook,
            job.item,
            job.slotIndexes.length,
            controller.signal,
            (message) => onStatus(`Holopix ${job.item.assetCode}：${message}`)
          );
          setStates((current) => updateSlotIndexes(current, job.item.key, job.slotIndexes, (slot, offset) => ({
            ...slot,
            status: "ready",
            image: images[offset]!,
            error: undefined
          })));
        } catch (error) {
          failedJobs += 1;
          const detail = toErrorMessage(error);
          setStates((current) => updateSlotIndexes(current, job.item.key, job.slotIndexes, (slot) => ({
            ...slot,
            status: "failed",
            error: detail
          })));
          onStatus(`Holopix ${job.item.assetCode} 生成失败：${detail}`, "error");
        } finally {
          completedJobs += 1;
          setPanelMessage(`批次进度 ${completedJobs}/${jobs.length}${failedJobs ? `；失败 ${failedJobs}` : ""}。`);
        }
      }
    };

    try {
      await Promise.all(Array.from({ length: Math.min(AI_GENERATION_CONCURRENCY, jobs.length) }, () => worker()));
      const detail = failedJobs
        ? `Holopix 批量结束：${jobs.length - failedJobs} 项成功，${failedJobs} 项失败，可点击失败格重试。`
        : `Holopix 批量完成：${jobs.length} 项，共 ${totalCandidates} 张候选。`;
      setPanelMessage(detail);
      onStatus(detail, failedJobs ? "warn" : "info");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setRunning(false);
    }
  }

  async function handleRegenerate(item: AssetCandidate, slotIndex: number): Promise<void> {
    if (!workbook || disabled) return;
    const state = states[item.key];
    if (!state) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setSelectedItemKey(item.key);
    setStates((current) => updateSlotIndexes(current, item.key, [slotIndex], (slot) => ({
      ...slot,
      status: "generating",
      error: undefined
    })));
    try {
      const images = await runItemGeneration(
        workbook,
        item,
        1,
        controller.signal,
        (message) => onStatus(`Holopix ${item.assetCode}：${message}`)
      );
      setStates((current) => updateSlotIndexes(current, item.key, [slotIndex], (slot) => ({
        ...slot,
        status: "ready",
        image: images[0]!,
        error: undefined
      })));
      setPanelMessage(`${item.assetCode} 的候选 ${state.candidates[slotIndex]?.label ?? ""} 已重新生成。`);
      onStatus(`Holopix 单格重生成完成：${item.assetCode}。`);
    } catch (error) {
      const detail = toErrorMessage(error);
      setStates((current) => updateSlotIndexes(current, item.key, [slotIndex], (slot) => ({
        ...slot,
        status: "failed",
        error: detail
      })));
      setPanelMessage(`生成失败：${detail}`);
      onStatus(`Holopix ${item.assetCode} 单格生成失败：${detail}`, "error");
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      setRunning(false);
    }
  }

  async function handleAccept(item: AssetCandidate, candidate: AiCandidateSlot): Promise<void> {
    if (!candidate.image || disabled) return;
    setSelectedItemKey(item.key);
    setStates((current) => {
      const state = current[item.key];
      return state ? { ...current, [item.key]: acceptAiCandidate(state, candidate.id) } : current;
    });
    setSyncingCandidateId(candidate.id);
    try {
      const result = await backfillAiCandidate(item.assetCode, candidate.image.url);
      setPanelMessage(result.detail);
      onStatus(result.detail, result.applied ? "info" : "warn");
    } catch (error) {
      const detail = `候选已选中，但回填 PSD 失败：${toErrorMessage(error)}`;
      setPanelMessage(detail);
      onStatus(detail, "error");
    } finally {
      setSyncingCandidateId(null);
    }
  }

  async function handleView(item: AssetCandidate, candidate: AiCandidateSlot): Promise<void> {
    if (!candidate.image || disabled) return;
    setSelectedItemKey(item.key);
    setOpeningCandidateId(candidate.id);
    try {
      await openHolopixCandidateExternally(candidate.image.url);
      const detail = `已在系统浏览器中打开 ${item.assetCode} 的候选 ${candidate.label}。`;
      setPanelMessage(detail);
      onStatus(detail);
    } catch (error) {
      const detail = `无法在系统浏览器中查看候选：${toErrorMessage(error)}`;
      setPanelMessage(detail);
      onStatus(detail, "error");
    } finally {
      setOpeningCandidateId(null);
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
        <small className="ai-panel-count">{stats.completed} / {stats.total || candidateCount}</small>
      </div>
      {open ? (
        <div className="panel-section-content ai-panel-content">
          <div className="ai-connection-card">
            <span className={`ai-status-dot ${workbook && generationItems.length ? "is-ready" : ""}`} />
            <span>
              {workbook
                ? "当前 PSD 已建立 · 参考图只用于图生文，生成节点不接图片"
                : "请先在“生成 PSD”中导入 Excel"}
            </span>
          </div>

          {selectedItem ? (
            <div className="ai-prompt-editor">
              <div className="ai-prompt-heading">
                <span>Holopix 图生文实际提示词</span>
                <small>ImageToPrompt → Generate</small>
              </div>
              <textarea
                readOnly
                value={promptDisplay}
                aria-label="Holopix 图片转提示词节点返回的实际提示词"
              />
              <small className="ai-prompt-source-detail">
                当前节点：{selectedItem.name || selectedItem.assetCode} · Excel 参考图只连接到
                HolopixImageToPrompt；HolopixGenerate 只接收其文字输出。生成或恢复后显示真实文本。
              </small>
            </div>
          ) : null}

          <div className="ai-generation-card">
            <div className="ai-generation-summary">
              <span>当前链 <strong>{generationItems.length}</strong> 个节点</span>
              <div className="ai-stepper" aria-label="每个棋子候选数量">
                <button
                  className="compact"
                  disabled={disabled || candidateCount <= 1}
                  onClick={() => setCandidateCount((value) => Math.max(1, value - 1))}
                >−</button>
                <strong>{candidateCount}</strong>
                <button
                  className="compact"
                  disabled={disabled || candidateCount >= 4}
                  onClick={() => setCandidateCount((value) => Math.min(4, value + 1))}
                >＋</button>
              </div>
            </div>
            <small>图生文 → 文生图 · 生成节点无参考图 · 固定 1:1 / 1024×1024</small>
            <button
              className="primary ai-generate-all"
              disabled={disabled || !workbook || !selectedGroup || !generationItems.length || remainingCount === 0}
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
              disabled={disabled || !generationItems.length}
              onClick={() => void handleRecoverExisting()}
            >{recovering ? "正在恢复……" : "恢复已有候选（不生成）"}</button>
          </div>

          <div className="ai-progress-card">
            <div><span>批次进度</span><strong>{stats.completed} / {stats.total}</strong></div>
            <progress value={stats.completed} max={Math.max(1, stats.total)} />
            <small>
              {stats.completed} 已完成　{stats.generating} 生成中　{stats.queued} 排队　{stats.failed} 失败
            </small>
          </div>

          <div className="ai-tabs">
            <button className={tab === "matrix" ? "is-active" : ""} onClick={() => setTab("matrix")}>候选矩阵</button>
            <button className={tab === "accepted" ? "is-active" : ""} onClick={() => setTab("accepted")}>已选链预览</button>
          </div>

          {activeGroups.length ? (
            <div className="ai-group-select">
              <label htmlFor="ai-group-select">棋子链</label>
              <select
                id="ai-group-select"
                value={selectedGroup?.id ?? ""}
                disabled={disabled}
                onChange={(event) => setSelectedGroupId(event.currentTarget.value)}
              >
                {activeGroups.map((group) => (
                  <option key={group.id} value={group.id}>{group.label}</option>
                ))}
              </select>
              <small>已选 {activeGroups.length} 条链</small>
            </div>
          ) : null}

          {tab === "matrix" ? (
            <div className="ai-matrix-shell">
              <div className="ai-matrix-header">
                <span>链节点</span><span>参考</span><span>候选</span>
              </div>
              <div className="ai-matrix-list">
                {groupItems.map((item, index) => {
                  const reference = selectedExcelImage(item);
                  const thumbnail = reference ? thumbnails[reference.anchor.archiveEntry] : undefined;
                  const state = states[item.key];
                  const active = selectedItem?.key === item.key;
                  return (
                    <div
                      className={`ai-matrix-row ${active ? "is-active" : ""}`}
                      key={item.key}
                      onClick={() => setSelectedItemKey(item.key)}
                    >
                      <div className="ai-node-copy">
                        <span className="ai-node-index">{index + 1}</span>
                        <span><strong>{item.name || item.assetCode}</strong><small>{item.assetCode}</small></span>
                      </div>
                      <ReferencePreview
                        item={item}
                        thumbnail={thumbnail}
                        onError={() => reference && onThumbnailError(reference.anchor.archiveEntry)}
                      />
                      <div className="ai-candidate-strip">
                        {state?.candidates.map((candidate, slotIndex) => (
                          <CandidateCell
                            key={candidate.id}
                            candidate={candidate}
                            disabled={disabled}
                            onAccept={() => void handleAccept(item, candidate)}
                            onRegenerate={() => void handleRegenerate(item, slotIndex)}
                          />
                        ))}
                        {!state ? <small className="ai-no-reference">无参考图，无法图生文</small> : null}
                      </div>
                    </div>
                  );
                })}
                {!groupItems.length ? <div className="ai-empty">请先在“生成 PSD”中选择至少一条棋子链。</div> : null}
              </div>
            </div>
          ) : (
            <div className="ai-accepted-grid">
              {groupItems.map((item) => {
                const accepted = states[item.key]?.candidates.find((candidate) => candidate.status === "accepted");
                return (
                  <div className="ai-accepted-item" key={item.key}>
                    {accepted?.image
                      ? <button
                          className="ai-accepted-view"
                          disabled={disabled}
                          title="点击在系统浏览器查看原图"
                          onClick={() => void handleView(item, accepted)}
                        >
                          {accepted.image.preview
                            ? <SafeCandidateCanvas preview={accepted.image.preview} />
                            : <span>{openingCandidateId === accepted.id ? "打开中" : "系统查看"}</span>}
                        </button>
                      : <span>未选择</span>}
                    <small>{item.name || item.assetCode}</small>
                  </div>
                );
              })}
            </div>
          )}

          <div className="ai-panel-message" role="status">{panelMessage}</div>
          <small className="ai-cost-note">点击生成后直接执行图生文，再以该文本提交文生图；停止等待不会撤销已提交的远程任务。</small>
        </div>
      ) : null}
    </section>
  );
}

function ReferencePreview({
  item,
  thumbnail,
  onError
}: {
  item: AssetCandidate;
  thumbnail?: ThumbnailRecord;
  onError: () => void;
}): React.ReactElement {
  return (
    <span className="ai-reference-preview">
      {thumbnail?.state === "ready" && thumbnail.url
        ? <img src={thumbnail.url} alt={`${item.name || item.assetCode} Excel 参考图`} onError={onError} />
        : <small>{thumbnail?.state === "loading" ? "加载中" : selectedExcelImage(item) ? "未预览" : "无图片"}</small>}
    </span>
  );
}

function CandidateCell({
  candidate,
  disabled,
  onAccept,
  onRegenerate
}: {
  candidate: AiCandidateSlot;
  disabled: boolean;
  onAccept: () => void;
  onRegenerate: () => void;
}): React.ReactElement {
  const interactive = Boolean(candidate.image) && (candidate.status === "ready" || candidate.status === "accepted");
  const preview = candidate.image?.preview;
  return (
    <div
      className={`ai-candidate-cell is-${candidate.status}`}
      title={candidate.error || candidate.image?.previewError || (
        candidate.status === "accepted"
          ? "已选中并回填 Photoshop"
          : interactive
            ? "点击图片选中并回填 Photoshop"
            : "点击生成或重试"
      )}
    >
      {interactive ? (
        <>
          {preview
            ? <SafeCandidateCanvas preview={preview} />
            : <small className="ai-candidate-preview-fallback">预览失败</small>}
          <button
            className="ai-candidate-select-surface"
            disabled={disabled || candidate.status === "accepted"}
            aria-label={candidate.status === "accepted" ? "已选中候选" : "选择并回填候选"}
            onClick={(event) => {
              event.stopPropagation();
              onAccept();
            }}
          />
        </>
      ) : (
        <button
          className="ai-candidate-generate"
          disabled={disabled || candidate.status === "queued" || candidate.status === "generating"}
          onClick={(event) => {
            event.stopPropagation();
            onRegenerate();
          }}
        >{candidateStatusLabel(candidate)}</button>
      )}
    </div>
  );
}

function SafeCandidateCanvas({
  preview
}: {
  preview: AiCandidatePreview;
}): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [renderFailed, setRenderFailed] = useState(false);
  const runs = useMemo(() => buildHolopixCanvasRuns(preview), [preview]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const context = canvas.getContext("2d");
      if (!context) throw new Error("当前 UXP 不支持 Canvas 2D 上下文。");
      context.clearRect(0, 0, HOLOPIX_CANVAS_PREVIEW_SIZE, HOLOPIX_CANVAS_PREVIEW_SIZE);
      for (const run of runs) {
        context.fillStyle = run.color;
        context.fillRect(run.x, run.y, run.width, 1);
      }
      setRenderFailed(false);
    } catch (error) {
      console.error("Holopix Canvas 安全预览绘制失败", error);
      setRenderFailed(true);
    }
  }, [runs]);

  if (renderFailed) return <small className="ai-candidate-preview-fallback">预览失败</small>;

  return (
    <canvas
      ref={canvasRef}
      className="ai-candidate-preview-canvas"
      width={HOLOPIX_CANVAS_PREVIEW_SIZE}
      height={HOLOPIX_CANVAS_PREVIEW_SIZE}
      aria-label="Holopix 安全候选缩略图"
    />
  );
}

async function runItemGeneration(
  workbook: ImportedWorkbook,
  item: AssetCandidate,
  candidateCount: number,
  signal: AbortSignal,
  onStage: (message: string) => void
) {
  const reference = selectedExcelImage(item);
  if (!reference) throw new Error("Excel 中没有可用于 Holopix 图生文的参考图。");
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
    candidateCount,
    assetCode: item.assetCode,
    signal,
    onStage
  });
}

function selectedExcelImage(item: AssetCandidate) {
  return item.imageCandidates.find((candidate) => candidate.id === item.selectedImageId)
    ?? item.imageCandidates[0];
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
