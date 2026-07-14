import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_TEMPLATE, type AssetCandidate, type SheetGroup } from "../domain/models";
import { applyScopedTaskValidation, selectImageCandidate } from "../domain/mapper";
import { filterItemsByGroups } from "../domain/sheetGroups";
import {
  imageDataUri,
  importWorkbook,
  importWorkbookFromFile,
  parseWorkbookSheet,
  type ImportedWorkbook
} from "../services/WorkbookService";
import { exportParsingManifest } from "../services/ParsingManifestService";
import { ThumbnailCache } from "../services/ThumbnailCache";
import { generateBatch } from "../photoshop/batchGenerator";
import { formatLog, makeLog, type LogEvent } from "../utils/logging";
import { toErrorMessage, UserCancelledError } from "../utils/errors";
import { defaultBatchBaseName } from "../utils/fileNames";
import { exportDiagnosticPackage } from "../services/DiagnosticPackageService";
import {
  clearRecentWorkbook,
  loadRecentWorkbookRecord,
  rememberWorkbook,
  restoreWorkbook
} from "../services/RecentWorkbookService";
import type { RecentWorkbookRecord } from "../domain/recentWorkbook";
import {
  changeActiveArtboardBackgroundColor,
  inspectActiveReferenceDocument,
  toggleActiveArtboardBackgrounds,
  toggleActiveGroupArtboards,
  toggleActiveReferenceView,
  watchActiveReferenceDocument,
  type ReferenceDocumentState
} from "../photoshop/referenceViewController";
import { PLUGIN_VERSION } from "../pluginMetadata";

type UiPhase =
  | "idle"
  | "importing"
  | "selectingSheet"
  | "parsingSheet"
  | "reviewing"
  | "exporting"
  | "diagnosing"
  | "generating"
  | "done"
  | "error";

interface ThumbnailRecord {
  state: "loading" | "ready" | "error";
  url?: string;
}

interface ThumbnailTask {
  entry: string;
  workbook: ImportedWorkbook;
  session: number;
}

interface BatchImageFeedback {
  rowOffset: number;
  appliedCount: number;
  missingItemKeys: string[];
}

interface UiError {
  area: "generator" | "currentPsd";
  message: string;
}

const LARGE_WORKBOOK_BYTES = 250 * 1024 * 1024;
const MAX_LIVE_THUMBNAILS = 32;

export function App(): React.ReactElement {
  const [phase, setPhase] = useState<UiPhase>("idle");
  const [workbook, setWorkbook] = useState<ImportedWorkbook | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [items, setItems] = useState<AssetCandidate[]>([]);
  const [groups, setGroups] = useState<SheetGroup[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [thumbnails, setThumbnails] = useState<Record<string, ThumbnailRecord>>({});
  const [message, setMessage] = useState("请选择腾讯文档导出的本地 .xlsx 副本。");
  const [logs, setLogs] = useState<LogEvent[]>([]);
  const [progress, setProgress] = useState<{ completed: number; total: number } | null>(null);
  const [showWorkbookDetails, setShowWorkbookDetails] = useState(false);
  const [showScopeDetails, setShowScopeDetails] = useState(true);
  const [showCurrentPsd, setShowCurrentPsd] = useState(true);
  const [showGenerator, setShowGenerator] = useState(true);
  const [showDiagnostics, setShowDiagnostics] = useState(false);
  const [referenceDocument, setReferenceDocument] = useState<ReferenceDocumentState | null>(null);
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [groupArtboardBusy, setGroupArtboardBusy] = useState(false);
  const [artboardBackgroundBusy, setArtboardBackgroundBusy] = useState<"color" | "visibility" | null>(null);
  const [batchImageFeedbackByGroup, setBatchImageFeedbackByGroup] = useState<Record<string, BatchImageFeedback>>({});
  const [collapsedItemGroupIds, setCollapsedItemGroupIds] = useState<string[]>([]);
  const [uiError, setUiError] = useState<UiError | null>(null);
  const [recentWorkbook, setRecentWorkbook] = useState<RecentWorkbookRecord | null>(
    () => loadRecentWorkbookRecord()
  );
  const initialPsdLayoutApplied = useRef(false);
  const thumbnailCache = useMemo(() => new ThumbnailCache(MAX_LIVE_THUMBNAILS), []);
  const thumbnailRequests = useRef(new Set<string>());
  const thumbnailOrder = useRef<string[]>([]);
  const thumbnailSession = useRef(0);
  const thumbnailQueue = useRef<ThumbnailTask[]>([]);
  const thumbnailActiveCount = useRef(0);

  const busy =
    phase === "importing" || phase === "parsingSheet" || phase === "exporting" ||
    phase === "diagnosing" || phase === "generating";
  const largeWorkbook = (workbook?.sourceSize ?? 0) > LARGE_WORKBOOK_BYTES;
  const activeGroups = useMemo(
    () => groups.filter((group) => selectedGroupIds.includes(group.id)),
    [groups, selectedGroupIds]
  );
  const allGroupsSelected = groups.length > 0 && groups.every((group) => selectedGroupIds.includes(group.id));
  const scopedItems = useMemo(
    () => applyScopedTaskValidation(filterItemsByGroups(items, activeGroups)),
    [items, activeGroups]
  );
  const selectedCount = scopedItems.filter((item) => item.selected).length;
  const blockedItemCount = scopedItems.filter((item) => hasErrors(item)).length;
  const selectedErrorCount = scopedItems
    .filter((item) => item.selected)
    .reduce((count, item) => count + item.issues.filter((issue) => issue.severity === "error").length, 0);
  const itemGroups = useMemo(
    () =>
      activeGroups
        .map((group) => ({ group, items: filterItemsByGroups(scopedItems, [group]) }))
        .filter((entry) => entry.items.length > 0),
    [activeGroups, scopedItems]
  );
  const formattedLogs = useMemo(() => logs.map(formatLog).join("\n"), [logs]);

  useEffect(() => watchActiveReferenceDocument(setReferenceDocument), []);

  useEffect(() => {
    if (!referenceDocument || initialPsdLayoutApplied.current) return;
    initialPsdLayoutApplied.current = true;
    setShowCurrentPsd(true);
    setShowGenerator(false);
  }, [referenceDocument]);

  const commitThumbnailRecord = useCallback((entry: string, record: ThumbnailRecord): void => {
    setThumbnails((current) => {
      const next = { ...current, [entry]: record };
      if (record.state === "ready" || record.state === "error") {
        thumbnailOrder.current = thumbnailOrder.current.filter((value) => value !== entry);
        thumbnailOrder.current.push(entry);
        while (thumbnailOrder.current.length > MAX_LIVE_THUMBNAILS) {
          const oldest = thumbnailOrder.current.shift();
          if (!oldest || oldest === entry) continue;
          delete next[oldest];
          thumbnailRequests.current.delete(oldest);
        }
      }
      return next;
    });
  }, []);

  const resetThumbnailPreviews = useCallback((): void => {
    thumbnailSession.current += 1;
    thumbnailRequests.current.clear();
    thumbnailOrder.current = [];
    thumbnailQueue.current = [];
    thumbnailActiveCount.current = 0;
    thumbnailCache.clear();
    setThumbnails({});
  }, [thumbnailCache]);

  const requestThumbnail = useCallback((entry: string): void => {
    if (!workbook || thumbnailRequests.current.has(entry)) return;
    const cached = thumbnailCache.get(entry);
    if (cached) {
      thumbnailRequests.current.add(entry);
      commitThumbnailRecord(entry, { state: "ready", url: cached });
      return;
    }

    const session = thumbnailSession.current;
    thumbnailRequests.current.add(entry);
    commitThumbnailRecord(entry, { state: "loading" });
    thumbnailQueue.current.push({ entry, workbook, session });

    const drainQueue = (): void => {
      while (thumbnailActiveCount.current < 4 && thumbnailQueue.current.length) {
        const task = thumbnailQueue.current.shift();
        if (!task || task.session !== thumbnailSession.current) continue;
        thumbnailActiveCount.current += 1;
        void imageDataUri(task.workbook, task.entry).then(
          (url) => {
            if (thumbnailSession.current !== task.session) return;
            thumbnailCache.set(task.entry, url);
            commitThumbnailRecord(task.entry, { state: "ready", url });
          },
          (error) => {
            if (thumbnailSession.current !== task.session) return;
            commitThumbnailRecord(task.entry, { state: "error" });
            appendLog(makeLog("warn", "thumbnail.load.failed", `${task.entry}: ${toErrorMessage(error)}`));
          }
        ).finally(() => {
          if (thumbnailSession.current !== task.session) return;
          thumbnailActiveCount.current = Math.max(0, thumbnailActiveCount.current - 1);
          drainQueue();
        });
      }
    };
    drainQueue();
  }, [commitThumbnailRecord, thumbnailCache, workbook]);

  function appendLog(event: LogEvent): void {
    setLogs((current) => [...current.slice(-199), event]);
    console[event.level === "error" ? "error" : event.level === "warn" ? "warn" : "log"](
      event.event,
      event.detail ?? ""
    );
  }

  function handleSheetChange(nextSheetName: string): void {
    if (!workbook || nextSheetName === sheetName) return;
    window.setTimeout(() => {
      setSheetName(nextSheetName);
      setShowScopeDetails(true);
      setCollapsedItemGroupIds([]);
      setProgress(null);
      void handleParseSheet(workbook, nextSheetName);
    }, 0);
  }

  function handleThumbnailDecodeError(entry: string): void {
    thumbnailCache.delete(entry);
    commitThumbnailRecord(entry, { state: "error" });
    appendLog(makeLog("warn", "thumbnail.decode.failed", entry));
  }

  async function acceptImportedWorkbook(imported: ImportedWorkbook): Promise<void> {
    const initialSheetName = imported.reader.index.sheets[0]?.name ?? "";
    setWorkbook(imported);
    setSheetName(initialSheetName);
    setItems([]);
    setGroups([]);
    setSelectedGroupIds([]);
    resetThumbnailPreviews();
    setUiError(null);
    setShowWorkbookDetails(false);
    setShowScopeDetails(true);
    setBatchImageFeedbackByGroup({});
    setCollapsedItemGroupIds([]);
    if (!initialSheetName) {
      const detail = "工作簿中没有可读取的工作表。";
      setPhase("error");
      setMessage(detail);
      presentError(detail, "generator");
      return;
    }
    setPhase("parsingSheet");
    setMessage(`正在自动获取工作表“${initialSheetName}”的棋子链……`);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    await handleParseSheet(imported, initialSheetName);
  }

  async function handleImport(): Promise<void> {
    setUiError(null);
    setPhase("importing");
    setMessage("正在建立 XLSX ZIP 与工作表索引……");
    appendLog(makeLog("info", "workbook.import.started"));
    try {
      const imported = await importWorkbook();
      appendLog(
        makeLog(
          "info",
          "workbook.import.completed",
          `${imported.sourceName}, ${imported.reader.index.sheets.length} sheets`
        )
      );
      await acceptImportedWorkbook(imported);
      try {
        const remembered = await rememberWorkbook(imported.sourceFile);
        setRecentWorkbook(remembered);
        if (remembered) {
          appendLog(makeLog("info", "workbook.recent.remembered", remembered.name));
        } else {
          clearRecentWorkbook();
          appendLog(makeLog("warn", "workbook.recent.unsupported", "当前 UXP 未提供 persistent token API"));
        }
      } catch (error) {
        appendLog(makeLog("warn", "workbook.recent.remember.failed", toErrorMessage(error)));
      }
    } catch (error) {
      handleError(error, "导入表格失败");
    }
  }

  async function handleOpenRecentWorkbook(): Promise<void> {
    if (!recentWorkbook) return;
    setUiError(null);
    setPhase("importing");
    setMessage(`正在打开最近文件“${recentWorkbook.name}”……`);
    appendLog(makeLog("info", "workbook.recent.open.started", recentWorkbook.name));
    try {
      const file = await restoreWorkbook(recentWorkbook);
      const imported = await importWorkbookFromFile(file);
      appendLog(makeLog("info", "workbook.recent.open.completed", imported.sourceName));
      await acceptImportedWorkbook(imported);
    } catch (error) {
      clearRecentWorkbook();
      setRecentWorkbook(null);
      setPhase("idle");
      const detail = toErrorMessage(error);
      const errorMessage = `最近文件无法读取，可能已移动、删除或权限已变化。请重新选择 XLSX。${detail ? `（${detail}）` : ""}`;
      setMessage(errorMessage);
      presentError(errorMessage, "generator");
      appendLog(makeLog("warn", "workbook.recent.open.failed", detail));
    }
  }

  async function handleParseSheet(
    targetWorkbook: ImportedWorkbook | null = workbook,
    targetSheetName: string = sheetName
  ): Promise<void> {
    if (!targetWorkbook || !targetSheetName) return;
    const descriptor = targetWorkbook.reader.index.sheets.find((sheet) => sheet.name === targetSheetName);
    if (!descriptor) return;
    setItems([]);
    setGroups([]);
    setSelectedGroupIds([]);
    resetThumbnailPreviews();
    setUiError(null);
    setBatchImageFeedbackByGroup({});
    setPhase("parsingSheet");
    setMessage(`正在获取工作表“${targetSheetName}”的棋子链……`);
    appendLog(makeLog("info", "sheet.parse.started", targetSheetName));
    try {
      const parsedResult = await parseWorkbookSheet(targetWorkbook, descriptor);
      setItems(parsedResult.items);
      setGroups(parsedResult.groups);
      setSelectedGroupIds([]);
      setShowScopeDetails(true);
      setPhase("reviewing");
      const ready = parsedResult.items.filter((item) => !hasErrors(item)).length;
      setMessage(
        `识别 ${parsedResult.groups.length} 个 A 列分组、${parsedResult.items.length} 项；请选择需要生成的范围。`
      );
      appendLog(
        makeLog(
          "info",
          "sheet.parse.completed",
          `${targetSheetName}, ${parsedResult.groups.length} groups, ${parsedResult.items.length} items, ${ready} ready`
        )
      );
    } catch (error) {
      handleError(error, "解析工作表失败");
    }
  }

  function handleCandidateChoice(itemKey: string, imageId: string): void {
    setItems((current) =>
      current.map((item) => (item.key === itemKey ? selectImageCandidate(item, imageId || undefined) : item))
    );
  }

  function handleBatchImageRowChoice(
    groupId: string,
    groupItems: AssetCandidate[],
    rowOffset: number
  ): void {
    const selectedImageIds = new Map<string, string>();
    const missingItemKeys: string[] = [];
    for (const item of groupItems) {
      const candidate = candidateAtRowOffset(item, rowOffset);
      if (candidate) selectedImageIds.set(item.key, candidate.id);
      else missingItemKeys.push(item.key);
    }

    setItems((current) =>
      current.map((item) => {
        const imageId = selectedImageIds.get(item.key);
        return imageId ? selectImageCandidate(item, imageId) : item;
      })
    );
    setBatchImageFeedbackByGroup((current) => ({
      ...current,
      [groupId]: {
        rowOffset,
        appliedCount: selectedImageIds.size,
        missingItemKeys
      }
    }));
    const detail = missingItemKeys.length
      ? `已选择第 ${rowOffset} 排 ${selectedImageIds.size} 项；${missingItemKeys.length} 项没有该排资源，已保留原选择。`
      : `已为本组 ${selectedImageIds.size} 项选择第 ${rowOffset} 排。`;
    setMessage(detail);
    appendLog(makeLog("info", "image.batch-row.selected", `${groupId}, row ${rowOffset}, ${selectedImageIds.size} applied, ${missingItemKeys.length} missing`));
  }

  function handleToggle(itemKey: string, selected: boolean): void {
    setItems((current) => current.map((item) => (item.key === itemKey ? { ...item, selected } : item)));
  }

  function handleGroupToggle(groupId: string, selected: boolean): void {
    setSelectedGroupIds((current) =>
      selected ? Array.from(new Set([...current, groupId])) : current.filter((id) => id !== groupId)
    );
  }

  function handleSelectAllGroups(selected: boolean): void {
    setSelectedGroupIds(selected ? groups.map((group) => group.id) : []);
  }

  async function handleExportManifest(): Promise<void> {
    if (!workbook || !scopedItems.length) return;
    setPhase("exporting");
    setMessage("请选择解析 Manifest 保存位置……");
    appendLog(makeLog("info", "parsing.manifest.export.started", `${sheetName}, ${scopedItems.length} items`));
    try {
      const fileName = await exportParsingManifest({
        workbook,
        sheetName,
        selectedGroups: activeGroups,
        items: scopedItems
      });
      setPhase("reviewing");
      setMessage(`解析 Manifest 已导出：${fileName}`);
      appendLog(makeLog("info", "parsing.manifest.export.completed", fileName));
    } catch (error) {
      handleError(error, "导出解析 Manifest 失败");
    }
  }

  async function handleExportDiagnostics(): Promise<void> {
    const started = makeLog("info", "diagnostics.export.started", `${logs.length} log events`);
    setPhase("diagnosing");
    setMessage("请选择诊断包保存位置……");
    appendLog(started);
    try {
      const fileName = await exportDiagnosticPackage({
        pluginVersion: PLUGIN_VERSION,
        phase,
        message,
        logs: [...logs, started],
        workbook: workbook ? {
          sourceName: workbook.sourceName,
          sourceSize: workbook.sourceSize,
          sourceModifiedAt: workbook.sourceModifiedAt,
          sheetCount: workbook.reader.index.sheets.length,
          zipEntryCount: workbook.reader.archive.listEntries().length
        } : undefined,
        sheetName: workbook ? sheetName : undefined,
        selectedGroups: activeGroups,
        items: scopedItems
      });
      setPhase(items.length ? "reviewing" : workbook ? "selectingSheet" : "idle");
      setMessage(`诊断包已导出：${fileName}`);
      appendLog(makeLog("info", "diagnostics.export.completed", fileName));
    } catch (error) {
      handleError(error, "导出诊断包失败");
    }
  }

  async function handleGenerate(): Promise<void> {
    if (!workbook) return;
    if (selectedErrorCount > 0) {
      const detail = `已选项目仍有 ${selectedErrorCount} 个阻断错误。`;
      setMessage(detail);
      presentError(detail, "generator");
      return;
    }
    setUiError(null);
    setPhase("generating");
    setProgress({ completed: 0, total: selectedCount });
    setMessage("请在保存弹窗中填写首卷 PSD 名称和保存位置……");
    appendLog(makeLog("info", "batch.generation.started", `${sheetName}, ${selectedCount} items`));
    try {
      const results = await generateBatch({
        workbook,
        sheetName,
        selectedGroups: activeGroups,
        items: scopedItems,
        template: DEFAULT_TEMPLATE,
        suggestedBaseName: defaultBatchBaseName(workbook.sourceName, sheetName),
        onProgress: ({ stage, completed, total }) => {
          setProgress({ completed, total });
          setMessage(`${stage}（${completed}/${total}）`);
        }
      });
      setReferenceDocument(await inspectActiveReferenceDocument());
      setPhase("done");
      setShowCurrentPsd(true);
      setShowGenerator(false);
      setMessage(`生成完成：${results.length} 个 PSD。`);
      appendLog(makeLog("info", "batch.generation.completed", `${results.length} volumes`));
    } catch (error) {
      handleError(error, "批量生成失败");
    }
  }

  async function handleReferenceViewToggle(): Promise<void> {
    if (!referenceDocument || referenceBusy || groupArtboardBusy || artboardBackgroundBusy) return;
    setUiError((current) => current?.area === "currentPsd" ? null : current);
    setReferenceBusy(true);
    try {
      const next = await toggleActiveReferenceView();
      setReferenceDocument(next);
      const detail = next?.referenceVisible
        ? "当前仅显示参考图。"
        : "已隐藏参考图，并保留其他图层的显示状态。";
      setMessage(detail);
      appendLog(makeLog("info", "reference-view.toggled", next?.mode ?? "unavailable"));
    } catch (error) {
      const detail = toErrorMessage(error);
      const errorMessage = `参考图切换失败：${detail}`;
      setMessage(errorMessage);
      presentError(errorMessage, "currentPsd");
      appendLog(makeLog("error", "reference-view.failed", detail));
    } finally {
      setReferenceBusy(false);
    }
  }

  async function handleGroupArtboardToggle(): Promise<void> {
    if (!referenceDocument?.groupArtboardsAvailable || referenceBusy || groupArtboardBusy || artboardBackgroundBusy) return;
    setUiError((current) => current?.area === "currentPsd" ? null : current);
    setGroupArtboardBusy(true);
    try {
      const next = await toggleActiveGroupArtboards();
      setReferenceDocument(next);
      const detail = next?.groupArtboardsVisible ? "已显示分组框。" : "已隐藏分组框。";
      setMessage(detail);
      appendLog(makeLog("info", "group-artboards.toggled", next?.groupArtboardsVisible ? "visible" : "hidden"));
    } catch (error) {
      const detail = toErrorMessage(error);
      const errorMessage = `分组框切换失败：${detail}`;
      setMessage(errorMessage);
      presentError(errorMessage, "currentPsd");
      appendLog(makeLog("error", "group-artboards.failed", detail));
    } finally {
      setGroupArtboardBusy(false);
    }
  }

  async function handleArtboardBackgroundColorChange(): Promise<void> {
    if (!referenceDocument?.artboardBackgroundsAvailable || referenceBusy || groupArtboardBusy || artboardBackgroundBusy) return;
    setUiError((current) => current?.area === "currentPsd" ? null : current);
    setArtboardBackgroundBusy("color");
    try {
      const result = await changeActiveArtboardBackgroundColor();
      setReferenceDocument(result.state);
      if (result.changed) {
        setMessage("已使用 Photoshop 拾色器中的颜色更新全部底板。");
        appendLog(makeLog("info", "artboard-background.color.changed", `${result.state.artboardBackgroundCount} layers`));
      } else {
        setMessage("已取消修改底板颜色。");
        appendLog(makeLog("info", "artboard-background.color.cancelled"));
      }
    } catch (error) {
      const detail = toErrorMessage(error);
      const errorMessage = `底板颜色修改失败：${detail}`;
      setMessage(errorMessage);
      presentError(errorMessage, "currentPsd");
      appendLog(makeLog("error", "artboard-background.color.failed", detail));
    } finally {
      setArtboardBackgroundBusy(null);
    }
  }

  async function handleArtboardBackgroundToggle(): Promise<void> {
    if (!referenceDocument?.artboardBackgroundsAvailable || referenceBusy || groupArtboardBusy || artboardBackgroundBusy) return;
    setUiError((current) => current?.area === "currentPsd" ? null : current);
    setArtboardBackgroundBusy("visibility");
    try {
      const next = await toggleActiveArtboardBackgrounds();
      setReferenceDocument(next);
      const detail = next?.artboardBackgroundsVisible ? "已显示全部底板颜色。" : "已隐藏全部底板颜色。";
      setMessage(detail);
      appendLog(makeLog("info", "artboard-background.visibility.toggled", next?.artboardBackgroundsVisible ? "visible" : "hidden"));
    } catch (error) {
      const detail = toErrorMessage(error);
      const errorMessage = `底板颜色切换失败：${detail}`;
      setMessage(errorMessage);
      presentError(errorMessage, "currentPsd");
      appendLog(makeLog("error", "artboard-background.visibility.failed", detail));
    } finally {
      setArtboardBackgroundBusy(null);
    }
  }

  function handleError(error: unknown, context: string): void {
    const detail = toErrorMessage(error);
    if (error instanceof UserCancelledError) {
      setPhase(items.length ? "reviewing" : workbook ? "selectingSheet" : "idle");
      setMessage(detail);
      appendLog(makeLog("warn", "user.cancelled", detail));
      return;
    }
    const errorMessage = `${context}：${detail}`;
    setPhase("error");
    setMessage(errorMessage);
    presentError(errorMessage, "generator");
    appendLog(makeLog("error", context, detail));
  }

  function presentError(errorMessage: string, area: UiError["area"]): void {
    setUiError({ area, message: errorMessage });
    setShowDiagnostics(true);
    if (area === "currentPsd") setShowCurrentPsd(true);
    else setShowGenerator(true);
  }

  return (
    <div className="app">
      {referenceDocument ? (
        <section className={`panel-section reference-control ${referenceDocument.mode === "reference" ? "is-reference" : ""}`}>
          <div
            className="panel-section-toggle"
            role="button"
            tabIndex={0}
            aria-expanded={showCurrentPsd}
            onClick={() => setShowCurrentPsd((value) => !value)}
            onKeyDown={(event) => handleDisclosureKey(event, () => setShowCurrentPsd((value) => !value))}
          >
            <span className={`panel-disclosure ${showCurrentPsd ? "is-open" : ""}`} aria-hidden="true">
              {showCurrentPsd ? "⌄" : ">"}
            </span>
            <span>当前 PSD</span>
          </div>
          {showCurrentPsd ? (
            <div className="panel-section-content reference-control-content">
              <div className="reference-control-actions">
                <button
                  className="compact"
                  disabled={busy || referenceBusy || groupArtboardBusy || Boolean(artboardBackgroundBusy) || !referenceDocument.supported}
                  onClick={() => void handleReferenceViewToggle()}
                >
                  {referenceBusy
                    ? "正在切换……"
                    : referenceDocument.referenceVisible ? "隐藏参考图" : "仅显示参考图"}
                </button>
                {referenceDocument.groupArtboardsAvailable ? (
                  <button
                    className="compact"
                    disabled={busy || referenceBusy || groupArtboardBusy || Boolean(artboardBackgroundBusy)}
                    onClick={() => void handleGroupArtboardToggle()}
                  >
                    {groupArtboardBusy
                      ? "正在切换……"
                      : referenceDocument.groupArtboardsVisible ? "隐藏分组框" : "显示分组框"}
                  </button>
                ) : null}
              </div>
              {referenceDocument.artboardBackgroundsAvailable ? (
                <div className="reference-control-actions">
                  <button
                    className="compact"
                    disabled={busy || referenceBusy || groupArtboardBusy || Boolean(artboardBackgroundBusy)}
                    onClick={() => void handleArtboardBackgroundColorChange()}
                  >
                    {artboardBackgroundBusy === "color" ? "正在选择……" : "修改底板颜色"}
                  </button>
                  <button
                    className="compact"
                    disabled={busy || referenceBusy || groupArtboardBusy || Boolean(artboardBackgroundBusy)}
                    onClick={() => void handleArtboardBackgroundToggle()}
                  >
                    {artboardBackgroundBusy === "visibility"
                      ? "正在切换……"
                      : referenceDocument.artboardBackgroundsVisible ? "隐藏底板颜色" : "显示底板颜色"}
                  </button>
                </div>
              ) : null}
              {uiError?.area === "currentPsd" ? (
                <div className="inline-error" role="alert">{uiError.message}</div>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className={`panel-section generator-panel ${showGenerator ? "is-open" : ""}`}>
        <div
          className="panel-section-toggle"
          role="button"
          tabIndex={0}
          aria-expanded={showGenerator}
          onClick={() => setShowGenerator((value) => !value)}
          onKeyDown={(event) => handleDisclosureKey(event, () => setShowGenerator((value) => !value))}
        >
          <span className={`panel-disclosure ${showGenerator ? "is-open" : ""}`} aria-hidden="true">
            {showGenerator ? "⌄" : ">"}
          </span>
          <span>生成 PSD</span>
        </div>
        {showGenerator ? (
          <div className="panel-section-content generator-content">

      {phase === "importing" || phase === "parsingSheet" ? <progress className="busy-progress" /> : null}
      {uiError?.area === "generator" ? (
        <div className="inline-error" role="alert">{uiError.message}</div>
      ) : null}

      {workbook && !showWorkbookDetails ? (
        <section
          className={`card compact-section disclosure-card ${busy ? "is-disabled" : ""}`}
          role="button"
          tabIndex={busy ? -1 : 0}
          aria-expanded={false}
          aria-disabled={busy}
          onClick={() => {
            if (!busy) setShowWorkbookDetails(true);
          }}
          onKeyDown={(event) => {
            if (!busy) handleDisclosureKey(event, () => setShowWorkbookDetails(true));
          }}
        >
          <span className="panel-disclosure" aria-hidden="true">&gt;</span>
          <div>
            <strong>{workbook.sourceName}</strong>
            <small>{workbook.reader.index.sheets.length} 个工作表 · {formatBytes(workbook.sourceSize ?? 0)}</small>
          </div>
        </section>
      ) : (
        <section className="card import-card">
          <div
            className={`section-heading disclosure-heading ${!workbook || busy ? "is-disabled" : ""}`}
            role="button"
            tabIndex={workbook && !busy ? 0 : -1}
            aria-expanded={true}
            aria-disabled={!workbook || busy}
            onClick={() => {
              if (workbook && !busy) setShowWorkbookDetails(false);
            }}
            onKeyDown={(event) => {
              if (workbook && !busy) handleDisclosureKey(event, () => setShowWorkbookDetails(false));
            }}
          >
            <span className={`panel-disclosure is-open ${workbook ? "" : "is-placeholder"}`} aria-hidden="true">
              {workbook ? "⌄" : ""}
            </span>
            <h2>导入表格</h2>
          </div>
          <button className="primary" disabled={busy} onClick={() => void handleImport()}>
            {phase === "importing" ? "正在读取……" : workbook ? "重新选择 XLSX" : "选择 XLSX"}
          </button>
          {recentWorkbook ? (
            <button className="secondary recent-file" disabled={busy} onClick={() => void handleOpenRecentWorkbook()}>
              打开最近文件：{recentWorkbook.name}
            </button>
          ) : null}
          {workbook ? (
            <dl className="facts">
              <dt>文件</dt><dd>{workbook.sourceName}</dd>
              <dt>大小</dt><dd>{formatBytes(workbook.sourceSize ?? 0)}</dd>
              <dt>工作表</dt><dd>{workbook.reader.index.sheets.length}</dd>
            </dl>
          ) : null}
          {largeWorkbook ? (
            <p className="large-file-warning">
              大文件模式：工作簿超过 250 MB。建议只选择需要的 A 列分组再生成。
            </p>
          ) : null}
        </section>
      )}

      {workbook ? (
        items.length && !showScopeDetails ? (
          <section
            className={`card compact-section disclosure-card ${busy ? "is-disabled" : ""}`}
            role="button"
            tabIndex={busy ? -1 : 0}
            aria-expanded={false}
            aria-disabled={busy}
            onClick={() => {
              if (!busy) setShowScopeDetails(true);
            }}
            onKeyDown={(event) => {
              if (!busy) handleDisclosureKey(event, () => setShowScopeDetails(true));
            }}
          >
            <span className="panel-disclosure" aria-hidden="true">&gt;</span>
            <div>
              <strong>{sheetName}</strong>
              <small>已选 {activeGroups.length}/{groups.length} 个 A 列分组 · {scopedItems.length} 项</small>
            </div>
          </section>
        ) : (
          <section className="card">
            <div
              className={`section-heading disclosure-heading ${busy ? "is-disabled" : ""}`}
              role="button"
              tabIndex={busy ? -1 : 0}
              aria-expanded={true}
              aria-disabled={busy}
              onClick={() => {
                if (!busy) setShowScopeDetails(false);
              }}
              onKeyDown={(event) => {
                if (!busy) handleDisclosureKey(event, () => setShowScopeDetails(false));
              }}
            >
              <span className="panel-disclosure is-open" aria-hidden="true">⌄</span>
              <h2>选择棋子链</h2>
            </div>
            <select
              aria-label="工作表"
              value={sheetName}
              disabled={busy}
              onChange={(event) => handleSheetChange(event.currentTarget.value)}
            >
              {workbook.reader.index.sheets.map((sheet) => (
                <option key={sheet.relationshipId} value={sheet.name}>
                  {sheet.name}{sheet.state !== "visible" ? `（${sheet.state}）` : ""}
                </option>
              ))}
            </select>
            {groups.length ? (
              <div className="group-picker">
                <div className="group-list-shell">
                  <div className="group-list-toolbar">
                    <span>已选 {activeGroups.length}/{groups.length}</span>
                    <button
                      className="compact group-select-toggle"
                      disabled={busy}
                      onClick={() => handleSelectAllGroups(!allGroupsSelected)}
                    >
                      {allGroupsSelected ? "清空全选" : "全选"}
                    </button>
                  </div>
                  <div className="group-list">
                    {groups.map((group) => (
                      <label className="group-option" key={group.id}>
                        <input
                          type="checkbox"
                          checked={selectedGroupIds.includes(group.id)}
                          disabled={busy}
                          onChange={(event) => handleGroupToggle(group.id, event.currentTarget.checked)}
                        />
                        <span>
                          <strong>{group.label}</strong>
                          <small>第 {group.startRow}–{group.endRow} 行 · {group.itemCount} 项</small>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}
          </section>
        )
      ) : null}

      {items.length && activeGroups.length ? (
        <>
          <div className="generation-action">
            <button
              className="primary"
              disabled={busy || selectedCount === 0 || selectedErrorCount > 0}
              onClick={() => void handleGenerate()}
            >
              {phase === "generating"
                ? `正在生成 ${progress?.completed ?? 0}/${progress?.total ?? selectedCount}`
                : `生成 ${selectedCount} 个画板`}
            </button>
            {blockedItemCount > 0 ? (
              <small className="blocking-note">已跳过 {blockedItemCount} 个问题项目，其余已选项目仍可生成。</small>
            ) : null}
          </div>

          <section className="item-list">
            {itemGroups.map(({ group, items: groupItems }) => {
              const rowChoices = batchImageRowChoices(groupItems);
              const hasBatchChoice = groupItems.some((item) => item.imageCandidates.length > 1) && rowChoices.length > 1;
              const feedback = batchImageFeedbackByGroup[group.id];
              const selectedRowOffset = feedback?.rowOffset ?? commonSelectedRowOffset(groupItems);
              const representativeChoice = rowChoices.find((choice) => choice.rowOffset === selectedRowOffset) ?? rowChoices[0];
              const representativeThumbnail = representativeChoice
                ? thumbnails[representativeChoice.representative.anchor.archiveEntry]
                : undefined;
              const missingItemKeys = new Set(feedback?.missingItemKeys ?? []);
              const groupCollapsed = collapsedItemGroupIds.includes(group.id);
              return (
              <article className={`asset-group ${groupCollapsed ? "is-collapsed" : ""}`} key={group.id}>
                <div
                  className="asset-group-header disclosure-heading"
                  role="button"
                  tabIndex={0}
                  aria-expanded={!groupCollapsed}
                  onClick={() => {
                    setCollapsedItemGroupIds((current) =>
                      current.includes(group.id)
                        ? current.filter((id) => id !== group.id)
                        : [...current, group.id]
                    );
                  }}
                  onKeyDown={(event) => handleDisclosureKey(event, () => {
                    setCollapsedItemGroupIds((current) =>
                      current.includes(group.id)
                        ? current.filter((id) => id !== group.id)
                        : [...current, group.id]
                    );
                  })}
                >
                  <span className={`panel-disclosure ${groupCollapsed ? "" : "is-open"}`} aria-hidden="true">
                    {groupCollapsed ? ">" : "⌄"}
                  </span>
                  <div className="asset-group-heading">
                    <strong>{group.label}</strong>
                    <span className="asset-group-meta">
                      {groupItems.length} 项 · {groupItems.reduce((count, item) => count + item.imageCandidates.length, 0)} 图
                      {hasBatchChoice && selectedRowOffset !== undefined ? ` · 第 ${selectedRowOffset} 排` : ""}
                    </span>
                  </div>
                </div>
                {!groupCollapsed ? (
                  <>
                {hasBatchChoice && representativeChoice ? (
                  <div className="batch-image-control">
                    <LazyThumbnail
                      className="batch-thumbnail"
                      record={representativeThumbnail}
                      alt={`第 ${representativeChoice.rowOffset} 排代表图`}
                      onVisible={() => requestThumbnail(representativeChoice.representative.anchor.archiveEntry)}
                      onError={() => handleThumbnailDecodeError(representativeChoice.representative.anchor.archiveEntry)}
                    />
                    <div className="batch-image-control-copy">
                      <span className="batch-image-title">批量选图</span>
                      <select
                        aria-label={`${group.label}批量选图`}
                        disabled={busy}
                        value={selectedRowOffset ?? ""}
                        onChange={(event) => {
                          const rowOffset = Number(event.currentTarget.value);
                          if (Number.isFinite(rowOffset)) handleBatchImageRowChoice(group.id, groupItems, rowOffset);
                        }}
                      >
                        {selectedRowOffset === undefined ? <option value="">选择图片排位</option> : null}
                        {rowChoices.map((choice) => (
                          <option key={choice.rowOffset} value={choice.rowOffset}>
                            第 {choice.rowOffset} 排 · {choice.coverage}/{groupItems.length}
                          </option>
                        ))}
                      </select>
                      <span className={`batch-image-feedback ${feedback?.missingItemKeys.length ? "has-missing" : ""}`}>
                        {feedback
                          ? `已切换 ${feedback.appliedCount} 项${feedback.missingItemKeys.length
                            ? `；${feedback.missingItemKeys.length} 项缺失并保留原选择`
                            : "；全部匹配"}`
                          : "选择后将应用到本组全部棋子"}
                      </span>
                    </div>
                  </div>
                ) : null}
                <div className="asset-group-items">
                  {groupItems.map((item) => (
                    <div
                      className={`asset-item ${hasErrors(item) ? "has-error" : ""} ${missingItemKeys.has(item.key) ? "batch-missing" : ""}`}
                      key={item.key}
                    >
                      <input
                        className="item-select"
                        type="checkbox"
                        checked={item.selected}
                        disabled={busy || hasErrors(item)}
                        aria-label={`选择 ${item.assetCode || item.name || "当前项目"}`}
                        onChange={(event) => handleToggle(item.key, event.currentTarget.checked)}
                      />
                      <div className="asset-item-content">
                        {item.imageCandidates.length ? item.imageCandidates.map((candidate) => {
                          const thumbnail = thumbnails[candidate.anchor.archiveEntry];
                          const selected = item.selectedImageId === candidate.id;
                          const hasMultipleImages = item.imageCandidates.length > 1;
                          return (
                            <div
                              className={`candidate ${hasMultipleImages ? "is-selectable" : ""} ${hasMultipleImages && selected ? "is-selected" : ""}`}
                              key={candidate.id}
                              onClick={() => {
                                if (hasMultipleImages && !busy) {
                                  handleCandidateChoice(item.key, candidate.id);
                                }
                              }}
                            >
                              <LazyThumbnail
                                className="candidate-thumbnail"
                                record={thumbnail}
                                alt={item.name || item.assetCode || "候选图片"}
                                onVisible={() => requestThumbnail(candidate.anchor.archiveEntry)}
                                onError={() => handleThumbnailDecodeError(candidate.anchor.archiveEntry)}
                              />
                              <span className="candidate-copy">
                                <strong>{item.assetCode || "（缺少 assetCode）"}</strong>
                                <span>{item.name || "（无名称）"}</span>
                                <small>ID {item.numericId || "缺失"}</small>
                              </span>
                            </div>
                          );
                        }) : (
                          <div className="candidate no-image">
                            <span className="thumb-placeholder">无图片</span>
                            <span className="candidate-copy">
                              <strong>{item.assetCode || "（缺少 assetCode）"}</strong>
                              <span>{item.name || "（无名称）"}</span>
                              <small>ID {item.numericId || "缺失"}</small>
                            </span>
                          </div>
                        )}
                        {item.issues.length ? (
                          <ul className="issues">
                            {item.issues.map((issue) => (
                              <li className={issue.severity} key={`${item.key}-${issue.code}`}>{issue.message}</li>
                            ))}
                          </ul>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>
                  </>
                ) : null}
              </article>
              );
            })}
          </section>

        </>
      ) : null}

          </div>
        ) : null}
      </section>

      <section className={`panel-section diagnostics-panel ${showDiagnostics ? "is-open" : ""}`}>
        <div
          className="panel-section-toggle diagnostics-toggle"
          role="button"
          tabIndex={0}
          aria-expanded={showDiagnostics}
          onClick={() => setShowDiagnostics((value) => !value)}
          onKeyDown={(event) => handleDisclosureKey(event, () => setShowDiagnostics((value) => !value))}
        >
          <span className={`panel-disclosure ${showDiagnostics ? "is-open" : ""}`} aria-hidden="true">
            {showDiagnostics ? "⌄" : ">"}
          </span>
          <span>运行与诊断</span>
        </div>
        {showDiagnostics ? (
          <div className="panel-section-content diagnostics-content">
          <div className="log-actions">
            <button className="compact" disabled={busy || !scopedItems.length} onClick={() => void handleExportManifest()}>
              {phase === "exporting" ? "正在导出……" : "导出解析 Manifest"}
            </button>
            <button className="compact" disabled={busy || (!logs.length && !workbook)} onClick={() => void handleExportDiagnostics()}>
              {phase === "diagnosing" ? "正在打包……" : "导出诊断包"}
            </button>
          </div>
            <pre className="logs">{formattedLogs || "尚无日志。"}</pre>
          </div>
        ) : null}
      </section>
    </div>
  );
}

interface LazyThumbnailProps {
  className: string;
  record?: ThumbnailRecord;
  alt: string;
  onVisible: () => void;
  onError: () => void;
}

function LazyThumbnail({ className, record, alt, onVisible, onError }: LazyThumbnailProps): React.ReactElement {
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const onVisibleRef = useRef(onVisible);
  onVisibleRef.current = onVisible;

  useEffect(() => {
    if (record?.state === "loading" || record?.state === "ready" || record?.state === "error") return;
    const element = rootRef.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      onVisibleRef.current();
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      onVisibleRef.current();
    }, { root: null, rootMargin: "180px 0px" });
    observer.observe(element);
    return () => observer.disconnect();
  }, [record?.state]);

  return (
    <span className={`lazy-thumbnail ${className}`} ref={rootRef}>
      {record?.state === "ready" && record.url ? (
        <img src={record.url} alt={alt} onError={onError} />
      ) : (
        <span className="lazy-thumbnail-placeholder">
          {record?.state === "loading" ? "加载中" : record?.state === "error" ? "无法预览" : "未加载"}
        </span>
      )}
    </span>
  );
}

function hasErrors(item: AssetCandidate): boolean {
  return item.issues.some((issue) => issue.severity === "error");
}

function handleDisclosureKey(event: React.KeyboardEvent<HTMLElement>, toggle: () => void): void {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  toggle();
}

function candidateAtRowOffset(
  item: AssetCandidate,
  rowOffset: number
): AssetCandidate["imageCandidates"][number] | undefined {
  return item.imageCandidates.find((candidate) => candidate.relativeRowOffset === rowOffset);
}

function batchImageRowChoices(items: AssetCandidate[]): Array<{
  rowOffset: number;
  coverage: number;
  selectedCount: number;
  representative: AssetCandidate["imageCandidates"][number];
}> {
  const rowOffsets = Array.from(
    new Set(items.flatMap((item) => item.imageCandidates.map((candidate) => candidate.relativeRowOffset)))
  ).sort((left, right) => left - right);

  return rowOffsets.flatMap((rowOffset) => {
    const matches = items.flatMap((item) => {
      const candidate = candidateAtRowOffset(item, rowOffset);
      return candidate ? [{ item, candidate }] : [];
    });
    const representative = matches[0]?.candidate;
    if (!representative) return [];
    return [{
      rowOffset,
      coverage: matches.length,
      selectedCount: matches.filter(({ item, candidate }) => item.selectedImageId === candidate.id).length,
      representative
    }];
  });
}

function commonSelectedRowOffset(items: AssetCandidate[]): number | undefined {
  const selectedOffsets = new Set(
    items.flatMap((item) => {
      const selected = item.imageCandidates.find((candidate) => candidate.id === item.selectedImageId);
      return selected ? [selected.relativeRowOffset] : [];
    })
  );
  return selectedOffsets.size === 1 ? selectedOffsets.values().next().value : undefined;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
