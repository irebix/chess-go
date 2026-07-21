import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  isLayerAvailable,
  readActiveLayerPixels,
  watchActiveLayerIdentity
} from "../centerline/layerSource";
import type { CenterlineLayerSource } from "../centerline/types";
import { ImageEditorComfyClient } from "../imageEditor/client";
import {
  inspectActiveImageEditorLayer,
  readActiveImageEditorLayerPreview,
  type ImageEditorLayerSummary
} from "../imageEditor/layerPreview";
import type {
  ImageEditorBatchSize,
  ImageEditorInsertPosition,
  ImageEditorReadyResult,
  ImageEditorWorkflowVersion
} from "../imageEditor/types";
import {
  insertImageEditorResults,
  sourceBoundsFromPixels
} from "../photoshop/imageEditorInsert";
import { toErrorMessage } from "../utils/errors";
import { SpectrumSelect } from "./SpectrumSelect";

interface AiEditPanelProps {
  externalBusy: boolean;
  onBusyChange: (busy: boolean) => void;
  onStatus: (detail: string, level?: "info" | "warn" | "error") => void;
}

type ConnectionState = "checking" | "ready" | "error";

const client = new ImageEditorComfyClient();
let sessionReadyResult: ImageEditorReadyResult | null = null;

const WORKFLOW_OPTIONS = [
  { value: "v3", label: "Holopix V3 · 2K" },
  { value: "v2", label: "Holopix V2 · 2K" }
] as const;

const BATCH_SIZES: readonly ImageEditorBatchSize[] = [1, 2, 4];

const INSERT_OPTIONS = [
  { value: "above", label: "来源图层上方" },
  { value: "top", label: "文档最上方" }
] as const;

function shiftBatchSize(
  current: ImageEditorBatchSize,
  direction: -1 | 1
): ImageEditorBatchSize {
  const currentIndex = BATCH_SIZES.indexOf(current);
  const nextIndex = Math.max(0, Math.min(BATCH_SIZES.length - 1, currentIndex + direction));
  return BATCH_SIZES[nextIndex] ?? current;
}

export function AiEditPanel({
  externalBusy,
  onBusyChange,
  onStatus
}: AiEditPanelProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>("checking");
  const [busy, setBusy] = useState(false);
  const [workflowVersion, setWorkflowVersion] = useState<ImageEditorWorkflowVersion>("v3");
  const [batchSize, setBatchSize] = useState<ImageEditorBatchSize>(1);
  const [insertPosition, setInsertPosition] = useState<ImageEditorInsertPosition>("above");
  const [keepSmartObject, setKeepSmartObject] = useState(false);
  const [promptText, setPromptText] = useState("");
  const [promptEditorHeight, setPromptEditorHeight] = useState(132);
  const [activeLayer, setActiveLayer] = useState<ImageEditorLayerSummary | null>(inspectActiveImageEditorLayer);
  const [layerPreviewUrl, setLayerPreviewUrl] = useState("");
  const [layerPreviewState, setLayerPreviewState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [progress, setProgress] = useState(0);
  const [progressStage, setProgressStage] = useState("正在检测 ComfyUI");
  const [readyResult, setReadyResult] = useState<ImageEditorReadyResult | null>(sessionReadyResult);
  const promptTextareaRef = useRef<SpectrumTextareaElement | null>(null);
  const promptResizeCleanupRef = useRef<(() => void) | null>(null);
  const layerPreviewRequestRef = useRef(0);
  const healthCheckedRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const currentPromptIdRef = useRef<string | null>(null);
  const lastReportedStageRef = useRef("");

  const commitBusy = useCallback((value: boolean): void => {
    setBusy(value);
    onBusyChange(value);
  }, [onBusyChange]);

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

  useEffect(() => () => {
    onBusyChange(false);
    abortControllerRef.current?.abort();
    promptResizeCleanupRef.current?.();
  }, [onBusyChange]);

  useEffect(() => watchActiveLayerIdentity(() => {
    setActiveLayer(inspectActiveImageEditorLayer());
    setReadyResult(sessionReadyResult);
  }), []);

  useEffect(() => {
    const requestId = ++layerPreviewRequestRef.current;
    setLayerPreviewUrl("");
    if (!open || !activeLayer) {
      setLayerPreviewState("idle");
      return;
    }
    setLayerPreviewState("loading");
    const timer = window.setTimeout(() => {
      void readActiveImageEditorLayerPreview().then((preview) => {
        if (layerPreviewRequestRef.current !== requestId) return;
        if (
          preview.documentId !== activeLayer.documentId
          || preview.layerId !== activeLayer.layerId
        ) return;
        setLayerPreviewUrl(preview.dataUrl);
        setLayerPreviewState("ready");
      }).catch(() => {
        if (layerPreviewRequestRef.current !== requestId) return;
        setLayerPreviewState("error");
      });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [activeLayer?.documentId, activeLayer?.layerId, open]);

  useEffect(() => {
    if (!open) return;
    const textarea = promptTextareaRef.current;
    if (!textarea) return;
    textarea.value = promptText;
    const handleInput = (): void => setPromptText(textarea.value);
    textarea.addEventListener("input", handleInput);
    return () => textarea.removeEventListener("input", handleInput);
  }, [open]);

  useEffect(() => {
    const textarea = promptTextareaRef.current;
    if (textarea && textarea.value !== promptText) textarea.value = promptText;
  }, [open, promptText]);

  useEffect(() => {
    if (!open || healthCheckedRef.current) return;
    const controller = new AbortController();
    let active = true;
    setConnection("checking");
    setProgressStage("正在检测 AI编辑工作流");
    void client.health(controller.signal).then(() => {
      if (!active) return;
      healthCheckedRef.current = true;
      setConnection("ready");
      setProgress(0);
      setProgressStage("等待任务");
      onStatus("AI编辑就绪 · 本地 ComfyUI 已提供 Holopix V2/V3");
    }).catch((error) => {
      if (!active || controller.signal.aborted) return;
      const detail = toErrorMessage(error);
      setConnection("error");
      setProgressStage("服务不可用");
      onStatus(`AI编辑服务不可用：${detail}`, "error");
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [onStatus, open]);

  const reportStage = useCallback((stage: string): void => {
    setProgressStage(stage);
    setProgress((current) => Math.max(current, stage.includes("上传") ? 18 : stage.includes("提交") ? 32 : 56));
    if (stage !== lastReportedStageRef.current) {
      lastReportedStageRef.current = stage;
      onStatus(`AI编辑：${stage}`);
    }
  }, [onStatus]);

  const insertReadyResult = useCallback(async (
    result: ImageEditorReadyResult = readyResult as ImageEditorReadyResult
  ): Promise<void> => {
    if (!result || busy || externalBusy) return;
    commitBusy(true);
    setProgress(90);
    setProgressStage("正在插入 Photoshop");
    try {
      await insertImageEditorResults(result, { keepSmartObject, insertPosition }, (completed, total) => {
        setProgress(90 + Math.round((completed / total) * 10));
        setProgressStage(`正在插入 Photoshop · ${completed}/${total}`);
        const remaining = result.images.slice(completed);
        if (remaining.length) {
          sessionReadyResult = { ...result, images: remaining };
          setReadyResult(sessionReadyResult);
        }
      });
      sessionReadyResult = null;
      setReadyResult(null);
      setProgress(100);
      setProgressStage("完成");
      onStatus(`AI编辑完成：已插入 ${result.images.length} 张 ${result.workflowVersion.toUpperCase()} 结果。`);
    } catch (error) {
      const detail = toErrorMessage(error);
      setProgressStage("结果已就绪，等待插入");
      onStatus(`AI编辑结果已就绪：${detail}`, "warn");
    } finally {
      commitBusy(false);
    }
  }, [busy, commitBusy, externalBusy, insertPosition, keepSmartObject, onStatus, readyResult]);

  const runImageEdit = useCallback(async (): Promise<void> => {
    if (busy || externalBusy || connection !== "ready") return;
    const prompt = promptText.trim();
    if (!prompt) {
      onStatus("AI编辑失败：请输入图片修改要求。", "error");
      return;
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    currentPromptIdRef.current = null;
    lastReportedStageRef.current = "";
    commitBusy(true);
    setProgress(4);
    setProgressStage("读取当前选中图层");
    onStatus(`AI编辑开始：${workflowVersion.toUpperCase()} · ${batchSize} 张`);
    try {
      const pixels = await readActiveLayerPixels({
        commandName: "AI编辑 · 读取当前图层",
        missingLayerMessage: "请先选中一个需要编辑的图层。"
      });
      setProgress(10);
      onStatus(`AI编辑读取图层：${pixels.layerName} · ${pixels.width} × ${pixels.height}`);
      const images = await client.generate({
        pixels,
        promptText: prompt,
        workflowVersion,
        batchSize,
        signal: controller.signal,
        onPromptId: (promptId) => {
          currentPromptIdRef.current = promptId;
          setProgress(38);
        },
        onStage: reportStage
      });
      currentPromptIdRef.current = null;
      const result: ImageEditorReadyResult = {
        images,
        source: {
          documentId: pixels.documentId,
          documentName: pixels.documentName,
          layerId: pixels.layerId,
          layerName: pixels.layerName
        },
        sourceBounds: sourceBoundsFromPixels(pixels),
        workflowVersion
      };
      sessionReadyResult = result;
      setReadyResult(result);
      setProgress(88);
      setProgressStage("结果已就绪，正在插入");
      await insertImageEditorResults(result, { keepSmartObject, insertPosition }, (completed, total) => {
        setProgress(88 + Math.round((completed / total) * 12));
        setProgressStage(`正在插入 Photoshop · ${completed}/${total}`);
        const remaining = result.images.slice(completed);
        if (remaining.length) {
          sessionReadyResult = { ...result, images: remaining };
          setReadyResult(sessionReadyResult);
        }
      });
      sessionReadyResult = null;
      setReadyResult(null);
      setProgress(100);
      setProgressStage("完成");
      onStatus(`AI编辑完成：已上传选中图层并插入 ${images.length} 张 ${workflowVersion.toUpperCase()} 结果。`);
    } catch (error) {
      const detail = toErrorMessage(error);
      const resultReady = Boolean(sessionReadyResult?.images.length);
      setProgressStage(resultReady ? "结果已就绪，等待插入" : controller.signal.aborted ? "已停止" : "处理失败");
      onStatus(
        resultReady
          ? `AI编辑结果已就绪：${detail}\n请切回来源文档后点击“插入就绪图片”。`
          : `AI编辑${controller.signal.aborted ? "已停止" : "失败"}：${detail}`,
        resultReady || controller.signal.aborted ? "warn" : "error"
      );
      console.error(error);
    } finally {
      abortControllerRef.current = null;
      currentPromptIdRef.current = null;
      commitBusy(false);
    }
  }, [batchSize, busy, commitBusy, connection, externalBusy, insertPosition, keepSmartObject, onStatus, promptText, reportStage, workflowVersion]);

  const cancelCurrentJob = useCallback(async (): Promise<void> => {
    abortControllerRef.current?.abort();
    const promptId = currentPromptIdRef.current;
    if (promptId) {
      try {
        await client.cancel(promptId);
        onStatus(`AI编辑已发送取消请求：${promptId}`, "warn");
      } catch (error) {
        onStatus(`AI编辑取消失败：${toErrorMessage(error)}`, "error");
      }
    }
  }, [onStatus]);

  const controlsDisabled = busy || externalBusy || connection !== "ready";
  const readyForCurrentDocument = Boolean(
    readyResult
    && activeLayer?.documentId === readyResult.source.documentId
    && isLayerAvailable(readyResult.source)
  );

  return (
    <section className={`panel-section ai-edit-panel ${open ? "is-open" : ""}`}>
      <div
        className="panel-section-toggle"
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
        <span>AI编辑</span>
      </div>
      {open ? (
        <div className="panel-section-content ai-edit-panel-content">
          <div className="image-editor-page">
            <section className="card image-editor-source-card">
              <div className={`image-editor-preview ${layerPreviewUrl ? "has-image" : ""}`}>
                {layerPreviewUrl ? (
                  <img src={layerPreviewUrl} alt={`${activeLayer?.layerName ?? "当前图层"}预览`} />
                ) : (
                  <span>
                    {layerPreviewState === "loading"
                      ? "正在读取"
                      : layerPreviewState === "error"
                        ? "暂不支持预览"
                        : "当前图层"}
                  </span>
                )}
              </div>
              <div className="image-editor-source-info">
                <strong>{activeLayer?.layerName ?? "未选择可读取图层"}</strong>
                <small>
                  {activeLayer ? `${activeLayer.width} × ${activeLayer.height}` : "请选择一个像素图层"}
                </small>
              </div>
            </section>

            <section className="card image-editor-controls-card">
              <div className="ai-setting-row">
                <span className="ai-setting-label">工作流</span>
                <div className="ai-setting-control">
                  <SpectrumSelect
                    ariaLabel="AI编辑工作流"
                    value={workflowVersion}
                    options={WORKFLOW_OPTIONS}
                    disabled={controlsDisabled}
                    onValueChange={(value) => setWorkflowVersion(value as ImageEditorWorkflowVersion)}
                  />
                </div>
              </div>
              <div className="ai-setting-row">
                <span className="ai-setting-label">生成数量</span>
                <div className="ai-setting-control is-compact">
                  <div className="ai-stepper" aria-label="AI编辑生成数量">
                    <button
                      className="compact"
                      disabled={controlsDisabled || batchSize === BATCH_SIZES[0]}
                      onClick={() => setBatchSize((value) => shiftBatchSize(value, -1))}
                    >−</button>
                    <strong>{batchSize}</strong>
                    <button
                      className="compact"
                      disabled={controlsDisabled || batchSize === BATCH_SIZES[BATCH_SIZES.length - 1]}
                      onClick={() => setBatchSize((value) => shiftBatchSize(value, 1))}
                    >＋</button>
                  </div>
                </div>
              </div>
              <div className="image-editor-prompt-heading">修改要求</div>
              <div className="ai-prompt-editor image-editor-prompt-editor">
                <div className="ai-prompt-textarea-shell">
                  <sp-textarea
                    ref={promptTextareaRef}
                    className="image-editor-prompt"
                    style={{
                      display: "block",
                      width: "100%",
                      minWidth: "100%",
                      maxWidth: "100%",
                      height: `${promptEditorHeight}px`
                    }}
                    placeholder="描述希望如何修改当前选中图层"
                    disabled={controlsDisabled || undefined}
                    aria-label="AI编辑提示词"
                  />
                  <span
                    className="ai-prompt-resize-handle"
                    role="separator"
                    aria-label="上下拖动调整修改要求输入框高度"
                    aria-orientation="horizontal"
                    onMouseDown={startPromptResize}
                  />
                </div>
              </div>
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
                    <label className="centerline-advanced-row image-editor-checkbox-row">
                      <input
                        type="checkbox"
                        checked={keepSmartObject}
                        disabled={busy || externalBusy}
                        onChange={(event) => setKeepSmartObject(event.currentTarget.checked)}
                      />
                      <span>插入为智能对象</span>
                    </label>
                    <div className="centerline-advanced-row ai-setting-row">
                      <span className="ai-setting-label">插入位置</span>
                      <div className="ai-setting-control">
                        <SpectrumSelect
                          ariaLabel="AI编辑插入位置"
                          value={insertPosition}
                          options={INSERT_OPTIONS}
                          disabled={busy || externalBusy}
                          onValueChange={(value) => setInsertPosition(value as ImageEditorInsertPosition)}
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="image-editor-actions">
                <button
                  className="primary"
                  disabled={controlsDisabled || !activeLayer || !promptText.trim()}
                  onClick={() => void runImageEdit()}
                >
                  上传选中图层并生成
                </button>
                {readyForCurrentDocument ? (
                  <button
                    className="secondary"
                    disabled={busy || externalBusy}
                    onClick={() => void insertReadyResult()}
                  >
                    插入就绪图片
                  </button>
                ) : null}
              </div>
            </section>

            <section className="card image-editor-progress-card">
              <div className="centerline-card-heading">
                <h2>任务进度</h2>
                <span>{Math.round(progress)}%</span>
              </div>
              <div className="ai-progress-track" aria-label={`AI编辑进度 ${Math.round(progress)}%`}>
                <div className="ai-progress-fill" style={{ width: `${progress}%` }} />
              </div>
              <div className="centerline-progress-footer">
                <div className="centerline-progress-stage">{progressStage}</div>
                <button
                  className="compact centerline-cancel-action"
                  disabled={!busy}
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
