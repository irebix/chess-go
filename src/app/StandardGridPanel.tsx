import React, { useCallback, useEffect, useState } from "react";
import { app } from "photoshop";
import {
  initializeGridMetadata,
  refreshOccupancy,
  scanOccupancy,
  subscribeGridLayout
} from "../photoshop/StandardGridCanvasService";
import {
  inspectGridCanvas,
  type GridCanvasInspection,
  type PlacementMode
} from "../photoshop/placementMode";
import type { GridOccupancySnapshot } from "../grid/GridOccupancyScanner";
import { toErrorMessage } from "../utils/errors";

interface StandardGridPanelProps {
  activeDocumentId: number | null;
  externalBusy: boolean;
  onBusyChange: (busy: boolean) => void;
  onModeChange: (mode: PlacementMode) => void;
  onStatus: (detail: string, level?: "info" | "warn" | "error") => void;
}

export function StandardGridPanel({
  activeDocumentId,
  externalBusy,
  onBusyChange,
  onModeChange,
  onStatus
}: StandardGridPanelProps): React.ReactElement | null {
  const [open, setOpen] = useState(true);
  const [inspection, setInspection] = useState<GridCanvasInspection | null>(null);
  const [occupancy, setOccupancy] = useState<GridOccupancySnapshot | null>(null);
  const [busy, setBusy] = useState(false);

  const commitBusy = useCallback((next: boolean): void => {
    setBusy(next);
    onBusyChange(next);
  }, [onBusyChange]);

  const inspectActive = useCallback((scanLayout: boolean): void => {
    const document = activeDocument();
    if (!document || activeDocumentId === null || document.id !== activeDocumentId) {
      setInspection(null);
      setOccupancy(null);
      onModeChange("UNSUPPORTED_CANVAS");
      return;
    }
    const next = inspectGridCanvas(document);
    setInspection(next);
    onModeChange(next.mode);
    if (next.mode === "STANDARD_GRID" && scanLayout) {
      setOccupancy(scanOccupancy(document));
    } else if (next.mode !== "STANDARD_GRID") {
      setOccupancy(null);
    }
  }, [activeDocumentId, onModeChange]);

  useEffect(() => {
    inspectActive(true);
  }, [inspectActive]);

  useEffect(() => subscribeGridLayout((snapshot) => {
    if (snapshot.documentId === activeDocumentId) setOccupancy(snapshot);
  }), [activeDocumentId]);

  useEffect(() => () => onBusyChange(false), [onBusyChange]);

  const initialize = useCallback(async (): Promise<void> => {
    const document = activeDocument();
    if (!document || busy || externalBusy) return;
    commitBusy(true);
    try {
      await initializeGridMetadata(document);
      const next = inspectGridCanvas(document);
      setInspection(next);
      onModeChange(next.mode);
      setOccupancy(scanOccupancy(document));
      onStatus("标准网格初始化完成；只创建了隐藏配置层，没有移动或缩放设计内容。");
    } catch (error) {
      onStatus(`初始化标准网格失败：${toErrorMessage(error)}`, "error");
    } finally {
      commitBusy(false);
    }
  }, [busy, commitBusy, externalBusy, onModeChange, onStatus]);

  const refresh = useCallback((): void => {
    const document = activeDocument();
    if (!document || busy || externalBusy) return;
    commitBusy(true);
    try {
      const next = refreshOccupancy(document);
      setOccupancy(next);
      onStatus(`标准网格布局已刷新：占用 ${next.occupiedSlots.size} / 96。`);
    } catch (error) {
      onStatus(`刷新标准网格布局失败：${toErrorMessage(error)}`, "error");
    } finally {
      commitBusy(false);
    }
  }, [busy, commitBusy, externalBusy, onStatus]);

  if (!inspection || inspection.mode === "ARTBOARD") return null;
  const occupied = occupancy?.occupiedSlots.size ?? 0;
  const initializeLabel = inspection.metadata.status === "missing"
    ? "初始化标准网格"
    : "重新初始化网格配置";

  return (
    <section className={`panel-section standard-grid-panel ${open ? "is-open" : ""}`}>
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
        <span>标准网格画布</span>
      </div>
      {open ? (
        <div className="panel-section-content standard-grid-content">
          {inspection.mode === "STANDARD_GRID" ? (
            <div className="card standard-grid-card">
              <strong>12 × 8 · 格子 144px · 间距 4px</strong>
              <div className="standard-grid-counts">
                <span>已占用：{occupied} / 96</span>
                <span>空闲：{96 - occupied} / 96</span>
              </div>
              <button
                className="compact"
                disabled={busy || externalBusy}
                onClick={refresh}
              >{busy ? "正在刷新……" : "刷新布局"}</button>
            </div>
          ) : (
            <div className="card standard-grid-card">
              <span>{inspection.message}</span>
              {inspection.canInitialize ? (
                <button
                  className="primary"
                  disabled={busy || externalBusy}
                  onClick={() => void initialize()}
                >{busy ? "正在初始化……" : initializeLabel}</button>
              ) : null}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function activeDocument(): ({ id: number } & Record<string, unknown>) | null {
  try {
    return app.documents?.length
      ? app.activeDocument as unknown as ({ id: number } & Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
