import React, { useCallback, useEffect, useRef, useState } from "react";
import { CenterlineComfyClient } from "../centerline/client";
import {
  assertActiveLayerSource,
  isLayerAvailable,
  readActiveLayerPixels,
  readLayerPixels,
  watchActiveLayerIdentity
} from "../centerline/layerSource";
import {
  convertSelectedPathToShapeLayer,
  createEditableWorkPath,
  deselectEditableWorkPath,
  removeEditableWorkPath,
  type PhotoshopPathItem
} from "../centerline/pathImporter";
import { createCenterlinePathTransform } from "../centerline/pathGeometry";
import { validatePathJson } from "../centerline/pathJson";
import type {
  CenterlineJob,
  CenterlineLayerSource,
  CenterlinePathJson,
  CenterlineReport,
  CenterlineVectorSettings
} from "../centerline/types";
import {
  isReadyResultAvailableForActiveDocument,
  shouldReportStoredOutlineAsReady
} from "../centerline/readyResultScope";
import { toErrorMessage } from "../utils/errors";

interface AiOutlinePanelProps {
  activeDocumentId: number | null;
  externalBusy: boolean;
  onBusyChange: (busy: boolean) => void;
  onStatus: (detail: string, level?: "info" | "warn" | "error") => void;
}

type ConnectionState = "checking" | "ready" | "error";

const client = new CenterlineComfyClient();
const CENTERLINE_OUTPUT_NAME = "Autoline";
const SOURCE_AVAILABILITY_RETRY_DELAYS_MS = [100, 250, 500];

interface SessionReusablePath {
  pathJson: CenterlinePathJson;
  source: CenterlineLayerSource;
  promptId: string;
  settings: CenterlineVectorSettings;
}

let sessionReusablePath: SessionReusablePath | null = null;

export function AiOutlinePanel({
  activeDocumentId,
  externalBusy,
  onBusyChange,
  onStatus
}: AiOutlinePanelProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const healthCheckedRef = useRef(false);
  const [connection, setConnection] = useState<ConnectionState>("checking");
  const [busy, setBusy] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const currentJobIdRef = useRef<string | null>(null);
  const [reusablePath, setReusablePath] = useState<SessionReusablePath | null>(sessionReusablePath);
  const [reusableSourceAvailable, setReusableSourceAvailable] = useState(
    () => Boolean(sessionReusablePath && isLayerAvailable(sessionReusablePath.source))
  );
  const [detail, setDetail] = useState(100);
  const [cornerSensitivity, setCornerSensitivity] = useState(80);
  const [smoothing, setSmoothing] = useState(100);
  const [strokeWidth, setStrokeWidth] = useState(2);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressStage, setProgressStage] = useState("正在检测 ComfyUI");
  const lastReportedStageRef = useRef("");
  const activeReusablePath = reusablePath
    && isReadyResultAvailableForActiveDocument(
      reusablePath.source,
      activeDocumentId,
      reusableSourceAvailable
    )
    ? reusablePath
    : null;

  const commitBusy = useCallback((value: boolean): void => {
    setBusy(value);
    onBusyChange(value);
  }, [onBusyChange]);

  useEffect(() => () => onBusyChange(false), [onBusyChange]);
  useEffect(() => watchActiveLayerIdentity(() => {
    setReusableSourceAvailable(Boolean(
      sessionReusablePath && isLayerAvailable(sessionReusablePath.source)
    ));
  }), []);
  useEffect(() => {
    if (!reusablePath) {
      setReusableSourceAvailable(false);
      return;
    }
    let disposed = false;
    let retryIndex = 0;
    let timer: number | undefined;
    const refresh = (): void => {
      const available = isLayerAvailable(reusablePath.source);
      if (disposed) return;
      setReusableSourceAvailable(available);
      if (available || retryIndex >= SOURCE_AVAILABILITY_RETRY_DELAYS_MS.length) return;
      timer = window.setTimeout(
        refresh,
        SOURCE_AVAILABILITY_RETRY_DELAYS_MS[retryIndex++]!
      );
    };
    refresh();
    return () => {
      disposed = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [activeDocumentId, reusablePath]);

  useEffect(() => {
    if (!open || healthCheckedRef.current) return;
    let active = true;
    void (async () => {
      setConnection("checking");
      setProgressStage("正在检测 ComfyUI");
      try {
        await client.health();
        if (!active) return;
        healthCheckedRef.current = true;
        setConnection("ready");
        setProgress(0);
        setProgressStage("等待任务");
        onStatus(activeReusablePath ? "AI勾线就绪 · 当前文档有就绪描边" : "AI勾线就绪");
      } catch (error) {
        if (!active) return;
        const detailMessage = toErrorMessage(error);
        setConnection("error");
        setProgress(0);
        setProgressStage("服务不可用");
        onStatus(`AI勾线服务不可用：${detailMessage}`, "error");
      }
    })();
    return () => { active = false; };
  }, [activeReusablePath, onStatus, open]);

  const updateJob = useCallback((job: CenterlineJob): void => {
    currentJobIdRef.current = job.id;
    setCurrentJobId(job.id);
    setProgress(normalizeProgress(job.progress));
    setProgressStage(job.stage);
    if (lastReportedStageRef.current !== job.stage) {
      lastReportedStageRef.current = job.stage;
      onStatus(`AI勾线任务 ${job.id}：${job.stage} · ${Math.round(normalizeProgress(job.progress))}%`);
    }
  }, [onStatus]);

  const runVectorization = useCallback(async (): Promise<void> => {
    if (busy || externalBusy || connection !== "ready") return;
    const outputName = CENTERLINE_OUTPUT_NAME;
    const normalizedStrokeWidth = Math.max(0.5, strokeWidth || 2);
    let createdPath: PhotoshopPathItem | null = null;
    let readySource: CenterlineLayerSource | null = null;
    commitBusy(true);
    lastReportedStageRef.current = "";
    setProgress(1);
    setProgressStage("读取 Photoshop 图层");
    onStatus("AI勾线开始：生成描边");
    try {
      const pixels = await readActiveLayerPixels();
      onStatus(`AI勾线读取图层：${pixels.layerName} · ${pixels.width} × ${pixels.height}`);
      const vectorSettings = { detail, cornerSensitivity, smoothing };
      const job = await client.createJob(pixels, vectorSettings);
      currentJobIdRef.current = job.id;
      setCurrentJobId(job.id);
      const completed = await client.waitForJob(job, updateJob);
      if (completed.status === "canceled") {
        setProgress(0);
        setProgressStage("已取消");
        onStatus("AI勾线任务已取消。", "warn");
        return;
      }
      if (completed.status !== "completed") {
        throw new Error(completed.error ?? `任务状态：${completed.status}`);
      }
      currentJobIdRef.current = null;
      setCurrentJobId(null);

      setProgress(97);
      setProgressStage("接收路径结果");
      const result = await client.getResult(completed.id);
      const pathJson = validatePathJson(result.pathJson);
      const nextReusablePath: SessionReusablePath = {
        pathJson,
        promptId: job.id,
        settings: vectorSettings,
        source: {
          documentId: pixels.documentId,
          documentName: pixels.documentName,
          layerId: pixels.layerId,
          layerName: pixels.layerName
        }
      };
      readySource = nextReusablePath.source;
      sessionReusablePath = nextReusablePath;
      setReusablePath(nextReusablePath);
      setReusableSourceAvailable(isLayerAvailable(nextReusablePath.source));
      assertActiveLayerSource(pixels);

      setProgress(98);
      setProgressStage("写入 Photoshop 描边");
      createdPath = await createEditableWorkPath(
        pathJson,
        outputName,
        createCenterlinePathTransform(pathJson, pixels),
        {
          keepSelected: true,
          documentId: pixels.documentId
        }
      );

      let shapeWarning: string | null = null;
      let shapeCreated = false;
      try {
        await convertSelectedPathToShapeLayer(
          normalizedStrokeWidth,
          outputName,
          pixels.documentId,
          pixels.layerId
        );
        shapeCreated = true;
        await removeEditableWorkPath(createdPath, pixels.documentId);
        try { await deselectEditableWorkPath(pixels.documentId); } catch { /* Shape is already usable. */ }
      } catch (error) {
        shapeWarning = toErrorMessage(error);
        console.warn("Shape 创建或工作路径清理失败；保留中间路径便于恢复。", error);
        try { await deselectEditableWorkPath(pixels.documentId); } catch { /* Keep the fallback path. */ }
      }

      setProgress(100);
      setProgressStage("完成");
      const outcome = shapeCreated
        ? "已创建可编辑 Shape 描边层。"
        : "Shape 转换失败；已保留中间工作路径便于恢复。";
      const resultSummary = formatResultStatus(outcome, result.report, normalizedStrokeWidth, shapeWarning);
      onStatus(`AI勾线完成：${resultSummary}`, shapeWarning ? "warn" : "info");
    } catch (error) {
      const detailMessage = toErrorMessage(error);
      if (shouldReportStoredOutlineAsReady(readySource)) {
        setProgress(100);
        setProgressStage("描边已就绪，等待插入");
        onStatus(
          `AI勾线描边已就绪：${detailMessage}\n请在来源文档中点击“插入就绪描边”。`,
          "warn"
        );
      } else {
        setProgressStage("处理失败");
        onStatus(`AI勾线失败：${detailMessage}`, "error");
      }
      console.error(error);
    } finally {
      currentJobIdRef.current = null;
      setCurrentJobId(null);
      commitBusy(false);
    }
  }, [
    busy,
    commitBusy,
    connection,
    cornerSensitivity,
    detail,
    externalBusy,
    onStatus,
    smoothing,
    strokeWidth,
    updateJob
  ]);

  const createEdgeShapeFromReusableResult = useCallback(async (): Promise<void> => {
    if (busy || externalBusy || !activeReusablePath) return;
    const outputName = CENTERLINE_OUTPUT_NAME;
    const normalizedStrokeWidth = Math.max(0.5, strokeWidth || 2);
    let createdPath: PhotoshopPathItem | null = null;
    let sourceDocumentId: number | null = null;
    commitBusy(true);
    setProgress(5);
    setProgressStage("读取来源图层位置");
    onStatus("AI勾线开始：插入就绪描边");
    try {
      const vectorSettings = { detail, cornerSensitivity, smoothing };
      let reusablePathForInsert = activeReusablePath;
      let pathJson = validatePathJson(reusablePathForInsert.pathJson);
      let refitted = false;
      if (!sameVectorSettings(reusablePathForInsert.settings, vectorSettings)) {
        lastReportedStageRef.current = "";
        setProgress(18);
        setProgressStage("绕过前序节点重新拟合路径");
        onStatus("AI勾线高级参数已更改：正在跳过前序节点并重新拟合路径。");
        const refitJob = await client.createRefitJob(
          reusablePathForInsert.promptId,
          vectorSettings
        );
        currentJobIdRef.current = refitJob.id;
        setCurrentJobId(refitJob.id);
        const completed = await client.waitForJob(refitJob, updateJob);
        if (completed.status === "canceled") {
          currentJobIdRef.current = null;
          setCurrentJobId(null);
          setProgress(0);
          setProgressStage("已取消");
          onStatus("AI勾线路径重新拟合已取消。", "warn");
          return;
        }
        if (completed.status !== "completed") {
          throw new Error(completed.error ?? `路径重新拟合状态：${completed.status}`);
        }
        currentJobIdRef.current = null;
        setCurrentJobId(null);
        setProgress(72);
        setProgressStage("接收重新拟合的路径");
        const refitResult = await client.getResult(completed.id);
        pathJson = validatePathJson(refitResult.pathJson);
        reusablePathForInsert = {
          ...reusablePathForInsert,
          pathJson,
          promptId: refitJob.id,
          settings: vectorSettings
        };
        sessionReusablePath = reusablePathForInsert;
        setReusablePath(reusablePathForInsert);
        refitted = true;
      }
      const pixels = await readLayerPixels(activeReusablePath.source);
      sourceDocumentId = pixels.documentId;
      const transform = createCenterlinePathTransform(pathJson, pixels);
      setProgress(refitted ? 82 : 55);
      setProgressStage("插入就绪路径结果");
      createdPath = await createEditableWorkPath(pathJson, outputName, transform, {
        keepSelected: true,
        documentId: pixels.documentId
      });
      await convertSelectedPathToShapeLayer(
        normalizedStrokeWidth,
        outputName,
        pixels.documentId,
        pixels.layerId
      );
      let cleanupWarning: string | null = null;
      try {
        await removeEditableWorkPath(createdPath, pixels.documentId);
      } catch (error) {
        cleanupWarning = toErrorMessage(error);
        console.warn("Shape 已创建，但中间工作路径清理失败。", error);
      }
      try { await deselectEditableWorkPath(pixels.documentId); } catch { /* Shape is already created. */ }
      setProgress(100);
      setProgressStage("完成");
      const resultSummary = [
        refitted
          ? "已绕过前序生成节点，按当前高级参数重新拟合并插入描边 Shape。"
          : "已插入就绪描边 Shape；高级参数未变，没有重新提交 ComfyUI。",
        `${pathJson.paths.length} 条路径 · ${countAnchors(pathJson)} 个锚点 · ${normalizedStrokeWidth}px`,
        cleanupWarning ? `中间路径清理提示：${cleanupWarning}` : null
      ].filter(Boolean).join("\n");
      onStatus(`AI勾线完成：${resultSummary}`, cleanupWarning ? "warn" : "info");
    } catch (error) {
      const detailMessage = toErrorMessage(error);
      if (createdPath && sourceDocumentId !== null) {
        try { await deselectEditableWorkPath(sourceDocumentId); } catch { /* Keep recoverable work path. */ }
      }
      setProgressStage("处理失败");
      onStatus(`AI勾线插入失败：${detailMessage}`, "error");
      console.error(error);
    } finally {
      currentJobIdRef.current = null;
      setCurrentJobId(null);
      commitBusy(false);
    }
  }, [
    activeReusablePath,
    busy,
    commitBusy,
    cornerSensitivity,
    detail,
    externalBusy,
    onStatus,
    smoothing,
    strokeWidth,
    updateJob
  ]);

  const cancelCurrentJob = useCallback(async (): Promise<void> => {
    const promptId = currentJobIdRef.current;
    if (!promptId) return;
    try {
      const job = await client.cancelJob(promptId);
      updateJob(job);
      onStatus(`AI勾线已提交取消请求：${promptId}`, "warn");
    } catch (error) {
      const detailMessage = toErrorMessage(error);
      onStatus(`AI勾线取消失败：${detailMessage}`, "error");
    }
  }, [onStatus, updateJob]);

  const controlsDisabled = externalBusy || busy || connection !== "ready";

  return (
    <section className={`panel-section centerline-panel ${open ? "is-open" : ""}`}>
      <div
        className="panel-section-toggle centerline-panel-toggle"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          setOpen((value) => !value);
        }}
      >
        <span className={`panel-disclosure ${open ? "is-open" : ""}`} aria-hidden="true">
          {open ? "⌄" : ">"}
        </span>
        <span>AI勾线</span>
      </div>
      {open ? (
        <div className="panel-section-content centerline-panel-content">
          <div className="centerline-page">
      <section className="card centerline-output-card">
        <div className="centerline-actions">
          <button className="primary" disabled={controlsDisabled} onClick={() => void runVectorization()}>
            生成描边
          </button>
          {activeReusablePath ? (
            <button
              className="secondary"
              disabled={externalBusy || busy}
              onClick={() => void createEdgeShapeFromReusableResult()}
            >
              插入就绪描边
            </button>
          ) : null}
        </div>
        {activeReusablePath ? (
          <small className="centerline-source-label">来源：{activeReusablePath.source.layerName}</small>
        ) : null}
        <CenterlineRange
          label="描边宽度"
          value={strokeWidth}
          min={0.5}
          max={32}
          step={0.5}
          disabled={busy || externalBusy}
          onChange={setStrokeWidth}
        />
        <div className={`centerline-advanced-shell ${advancedOpen ? "is-open" : ""}`}>
          <div
            className={`centerline-advanced-toggle ${busy || externalBusy ? "is-disabled" : ""}`}
            role="button"
            tabIndex={busy || externalBusy ? -1 : 0}
            aria-expanded={advancedOpen}
            aria-disabled={busy || externalBusy}
            onClick={() => {
              if (!busy && !externalBusy) setAdvancedOpen((value) => !value);
            }}
            onKeyDown={(event) => {
              if (busy || externalBusy || (event.key !== "Enter" && event.key !== " ")) return;
              event.preventDefault();
              setAdvancedOpen((value) => !value);
            }}
          >
            <span className="centerline-advanced-label">高级选项</span>
            <span className={`panel-disclosure ${advancedOpen ? "is-open" : ""}`} aria-hidden="true">
              {advancedOpen ? "⌄" : ">"}
            </span>
          </div>
          {advancedOpen ? (
            <div className="centerline-advanced-content">
              <CenterlineRange
                label="精细度"
                value={detail}
                min={0}
                max={100}
                step={1}
                disabled={busy || externalBusy}
                onChange={setDetail}
                grouped
              />
              <CenterlineRange
                label="折角敏感度"
                value={cornerSensitivity}
                min={0}
                max={100}
                step={1}
                disabled={busy || externalBusy}
                onChange={setCornerSensitivity}
                grouped
              />
              <CenterlineRange
                label="平滑度"
                value={smoothing}
                min={0}
                max={100}
                step={1}
                disabled={busy || externalBusy}
                onChange={setSmoothing}
                grouped
              />
            </div>
          ) : null}
        </div>
      </section>

      <section className="card centerline-progress-card">
        <div className="centerline-card-heading">
          <h2>任务进度</h2>
          <span>{Math.round(progress)}%</span>
        </div>
        <div className="ai-progress-track" aria-label={`AI勾线进度 ${Math.round(progress)}%`}>
          <div className="ai-progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="centerline-progress-footer">
          <div className="centerline-progress-stage">{progressStage}</div>
          <button
            className="compact centerline-cancel-action"
            disabled={!busy || !currentJobId}
            onClick={() => void cancelCurrentJob()}
          >
            取消任务
          </button>
        </div>
      </section>

          </div>
        </div>
      ) : null}
    </section>
  );
}

interface CenterlineRangeProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled: boolean;
  onChange: (value: number) => void;
  grouped?: boolean;
}

function CenterlineRange({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onChange,
  grouped = false
}: CenterlineRangeProps): React.ReactElement {
  const [draftValue, setDraftValue] = useState(String(value));

  useEffect(() => {
    setDraftValue(String(value));
  }, [value]);

  const commitDraftValue = (): void => {
    const parsed = draftValue.trim() === "" ? Number.NaN : Number(draftValue);
    const normalized = Number.isFinite(parsed)
      ? Math.max(min, Math.min(max, parsed))
      : value;
    setDraftValue(String(normalized));
    if (normalized !== value) onChange(normalized);
  };

  return (
    <div className={`${grouped ? "centerline-advanced-row" : "generation-setting-control"} centerline-range`}>
      <div className="centerline-range-heading">
        <span>{label}</span>
      </div>
      <div className="centerline-range-control">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          aria-label={`${label}滑杆`}
          onChange={(event) => {
            const nextValue = Number(event.currentTarget.value);
            setDraftValue(String(nextValue));
            onChange(nextValue);
          }}
        />
        <input
          className="generation-setting-input centerline-range-number"
          type="number"
          min={min}
          max={max}
          step={step}
          value={draftValue}
          disabled={disabled}
          aria-label={`${label}数值`}
          onChange={(event) => {
            const nextDraft = event.currentTarget.value;
            setDraftValue(nextDraft);
            const parsed = Number(nextDraft);
            if (nextDraft !== "" && Number.isFinite(parsed) && parsed >= min && parsed <= max) {
              onChange(parsed);
            }
          }}
          onBlur={commitDraftValue}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            commitDraftValue();
            event.currentTarget.blur();
          }}
        />
      </div>
    </div>
  );
}

function normalizeProgress(progress: number): number {
  return Math.max(0, Math.min(100, Number(progress) || 0));
}

function countAnchors(pathJson: CenterlinePathJson): number {
  return pathJson.paths.reduce((sum, path) => sum + path.points.length, 0);
}

function sameVectorSettings(
  left: CenterlineVectorSettings,
  right: CenterlineVectorSettings
): boolean {
  return left.detail === right.detail
    && left.cornerSensitivity === right.cornerSensitivity
    && left.smoothing === right.smoothing;
}

function formatResultStatus(
  outcome: string,
  report: CenterlineReport,
  strokeWidth: number,
  warning: string | null
): string {
  const details = [
    report.pathCount !== undefined ? `${report.pathCount} 条路径` : null,
    report.totalAnchors !== undefined ? `${report.totalAnchors} 个锚点` : null,
    `${strokeWidth}px`
  ].filter(Boolean).join(" · ");
  return [outcome, details, warning ? `提示：${warning}` : null].filter(Boolean).join("\n");
}
