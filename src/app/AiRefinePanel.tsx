import React, { useCallback, useEffect, useRef, useState } from "react";
import { inspectActiveLayerIdentity, watchActiveLayerIdentity } from "../centerline/layerSource";
import type { CenterlineLayerIdentity } from "../centerline/types";
import { ImageRefinerComfyClient } from "../imageRefiner/client";
import {
  IMAGE_REFINER_MAX_LAYERS,
  type ImageRefinerGroupSource,
  type ImageRefinerReadyResult
} from "../imageRefiner/types";
import { insertImageRefinerResults } from "../photoshop/imageRefinerInsert";
import {
  inspectActiveImageRefinerGroup,
  isImageRefinerGroupAvailable
} from "../photoshop/imageRefinerSource";
import { toErrorMessage } from "../utils/errors";

interface AiRefinePanelProps {
  externalBusy: boolean;
  onBusyChange: (busy: boolean) => void;
  onStatus: (detail: string, level?: "info" | "warn" | "error") => void;
}

type ConnectionState = "checking" | "ready" | "error";

const client = new ImageRefinerComfyClient();
let sessionReadyResult: ImageRefinerReadyResult | null = null;

export function AiRefinePanel({
  externalBusy,
  onBusyChange,
  onStatus
}: AiRefinePanelProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [connection, setConnection] = useState<ConnectionState>("checking");
  const [busy, setBusy] = useState(false);
  const [activeIdentity, setActiveIdentity] = useState<CenterlineLayerIdentity | null>(
    inspectActiveLayerIdentity
  );
  const [sourceGroup, setSourceGroup] = useState<ImageRefinerGroupSource | null>(
    inspectActiveImageRefinerGroup
  );
  const [promptText, setPromptText] = useState("");
  const [promptEditorHeight, setPromptEditorHeight] = useState(150);
  const [progress, setProgress] = useState(0);
  const [progressStage, setProgressStage] = useState("正在检测 ComfyUI");
  const [readyResult, setReadyResult] = useState<ImageRefinerReadyResult | null>(sessionReadyResult);
  const promptTextareaRef = useRef<SpectrumTextareaElement | null>(null);
  const promptResizeCleanupRef = useRef<(() => void) | null>(null);
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
      setPromptEditorHeight(Math.max(100, Math.min(360, Math.round(startHeight + moveEvent.clientY - startY))));
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

  useEffect(() => watchActiveLayerIdentity((identity) => {
    setActiveIdentity(identity);
    setSourceGroup(inspectActiveImageRefinerGroup());
    setReadyResult(sessionReadyResult);
  }), []);

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
    setProgressStage("正在检测 AI细化工作流");
    void client.health(controller.signal).then(() => {
      if (!active) return;
      healthCheckedRef.current = true;
      setConnection("ready");
      setProgress(0);
      setProgressStage("等待任务");
      onStatus("AI细化就绪 · 本地 ComfyUI 已加载动态拼接 V3 工作流");
    }).catch((error) => {
      if (!active || controller.signal.aborted) return;
      setConnection("error");
      setProgressStage("服务不可用");
      onStatus(`AI细化服务不可用：${toErrorMessage(error)}`, "error");
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [onStatus, open]);

  const reportStage = useCallback((stage: string): void => {
    setProgressStage(stage);
    setProgress((current) => (
      stage.includes("读取并上传")
        ? current
        : Math.max(current, stage.includes("提交") ? 46 : 58)
    ));
    if (stage !== lastReportedStageRef.current) {
      lastReportedStageRef.current = stage;
      onStatus(`AI细化：${stage}`);
    }
  }, [onStatus]);

  const insertReady = useCallback(async (
    result: ImageRefinerReadyResult = readyResult as ImageRefinerReadyResult
  ): Promise<void> => {
    if (!result || busy || externalBusy) return;
    commitBusy(true);
    setProgress(88);
    setProgressStage("正在新建细化图层组");
    try {
      await insertImageRefinerResults(result, (completed, total) => {
        setProgress(88 + Math.round((completed / total) * 12));
        setProgressStage(`正在对应回插图层 · ${completed}/${total}`);
      });
      sessionReadyResult = null;
      setReadyResult(null);
      setProgress(100);
      setProgressStage("完成");
      onStatus(`AI细化完成：已新建“${result.source.groupName} 细化”并回插 ${result.images.length} 个图层。`);
    } catch (error) {
      setProgressStage("结果已就绪，等待插入");
      onStatus(`AI细化结果已就绪：${toErrorMessage(error)}`, "warn");
    } finally {
      commitBusy(false);
    }
  }, [busy, commitBusy, externalBusy, onStatus, readyResult]);

  const runRefinement = useCallback(async (): Promise<void> => {
    if (busy || externalBusy || connection !== "ready") return;
    const source = inspectActiveImageRefinerGroup();
    if (!source) {
      onStatus("AI细化失败：请先选中一个图层组。", "error");
      return;
    }
    if (!source.layers.length) {
      onStatus("AI细化失败：所选图层组中没有可读取的智能对象或栅格图层。", "error");
      return;
    }
    if (source.layers.length > IMAGE_REFINER_MAX_LAYERS) {
      onStatus(`AI细化失败：单批最多处理 ${IMAGE_REFINER_MAX_LAYERS} 个图层。`, "error");
      return;
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;
    currentPromptIdRef.current = null;
    lastReportedStageRef.current = "";
    commitBusy(true);
    setProgress(3);
    setProgressStage("准备读取图层组");
    onStatus(`AI细化开始：${source.groupName} · ${source.layers.length} 个图层`);
    try {
      const images = await client.generate({
        source,
        promptSupplement: promptText.trim(),
        signal: controller.signal,
        onPromptId: (promptId) => {
          currentPromptIdRef.current = promptId;
          setProgress(50);
        },
        onStage: reportStage,
        onUploadProgress: (completed, total) => {
          setProgress(5 + Math.round((completed / total) * 35));
          setProgressStage(`已上传图层 · ${completed}/${total}`);
        }
      });
      currentPromptIdRef.current = null;
      const effectiveSource = images.length === source.layers.length
        ? source
        : { ...source, layers: source.layers.slice(0, images.length) };
      const result: ImageRefinerReadyResult = { images, source: effectiveSource };
      sessionReadyResult = result;
      setReadyResult(result);
      setProgress(86);
      setProgressStage("结果已就绪，正在回插");
      await insertImageRefinerResults(result, (completed, total) => {
        setProgress(88 + Math.round((completed / total) * 12));
        setProgressStage(`正在对应回插图层 · ${completed}/${total}`);
      });
      sessionReadyResult = null;
      setReadyResult(null);
      setProgress(100);
      setProgressStage("完成");
      onStatus(`AI细化完成：已批量处理并回插 ${images.length} 个图层到“${source.groupName} 细化”。`);
    } catch (error) {
      const resultReady = Boolean(sessionReadyResult?.images.length);
      const detail = toErrorMessage(error);
      setProgressStage(resultReady ? "结果已就绪，等待插入" : controller.signal.aborted ? "已停止" : "处理失败");
      onStatus(
        resultReady
          ? `AI细化结果已就绪：${detail}\n请切回来源文档后点击“插入就绪细化图片”。`
          : `AI细化${controller.signal.aborted ? "已停止" : "失败"}：${detail}`,
        resultReady || controller.signal.aborted ? "warn" : "error"
      );
      console.error(error);
    } finally {
      abortControllerRef.current = null;
      currentPromptIdRef.current = null;
      commitBusy(false);
    }
  }, [busy, commitBusy, connection, externalBusy, onStatus, promptText, reportStage]);

  const cancelCurrentJob = useCallback(async (): Promise<void> => {
    abortControllerRef.current?.abort();
    const promptId = currentPromptIdRef.current;
    if (!promptId) return;
    try {
      await client.cancel(promptId);
      onStatus(`AI细化已发送取消请求：${promptId}`, "warn");
    } catch (error) {
      onStatus(`AI细化取消失败：${toErrorMessage(error)}`, "error");
    }
  }, [onStatus]);

  const controlsDisabled = busy || externalBusy || connection !== "ready";
  const validSourceCount = sourceGroup?.layers.length ?? 0;
  const readyForCurrentDocument = Boolean(
    readyResult
    && activeIdentity?.documentId === readyResult.source.documentId
    && isImageRefinerGroupAvailable(readyResult.source)
  );

  return (
    <section className={`panel-section ai-refine-panel ${open ? "is-open" : ""}`}>
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
        <span>AI细化</span>
      </div>
      {open ? (
        <div className="panel-section-content ai-refine-panel-content">
          <div className="image-editor-page">
            <section className="card image-refiner-source-card">
              <div className="image-refiner-source-icon" aria-hidden="true">组</div>
              <div className="image-editor-source-info">
                <strong>{sourceGroup?.groupName ?? "未选择图层组"}</strong>
                <small>
                  {sourceGroup
                    ? `${validSourceCount} 个可细化图层${sourceGroup.skippedLayerCount ? ` · 跳过 ${sourceGroup.skippedLayerCount} 个非图片图层` : ""}`
                    : "请选择包含智能对象或栅格图层的图层组"}
                </small>
              </div>
            </section>

            <section className="card image-editor-controls-card">
              <div className="image-editor-prompt-heading">补充要求（可选）</div>
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
                    placeholder="可选：填写内容会追加到 ComfyUI 主提示词末尾"
                    disabled={controlsDisabled || undefined}
                    aria-label="AI细化补充要求"
                  />
                  <span
                    className="ai-prompt-resize-handle"
                    role="separator"
                    aria-label="上下拖动调整细化要求输入框高度"
                    aria-orientation="horizontal"
                    onMouseDown={startPromptResize}
                  />
                </div>
              </div>
              <div className="image-refiner-actions">
                <button
                  className="primary"
                  disabled={
                    controlsDisabled
                    || !sourceGroup
                    || !validSourceCount
                    || validSourceCount > IMAGE_REFINER_MAX_LAYERS
                  }
                  onClick={() => void runRefinement()}
                >
                  批量细化选中图层组
                </button>
                {readyForCurrentDocument ? (
                  <button
                    className="secondary"
                    disabled={busy || externalBusy}
                    onClick={() => void insertReady()}
                  >
                    插入就绪细化图片
                  </button>
                ) : null}
              </div>
            </section>

            <section className="card image-editor-progress-card">
              <div className="centerline-card-heading">
                <h2>任务进度</h2>
                <span>{Math.round(progress)}%</span>
              </div>
              <div className="ai-progress-track" aria-label={`AI细化进度 ${Math.round(progress)}%`}>
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
