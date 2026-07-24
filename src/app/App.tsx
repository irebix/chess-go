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
import {
  DEFAULT_EDITABLE_CANVAS_SIZE,
  MAX_ARTBOARD_SPACING,
  MAX_EDITABLE_CANVAS_SIZE,
  MIN_ARTBOARD_SPACING,
  MIN_EDITABLE_CANVAS_SIZE,
  isValidArtboardSpacing,
  isValidEditableCanvasSize
} from "../domain/generationSettings";
import {
  loadGenerationSettings,
  saveGenerationSettings
} from "../services/GenerationSettingsService";
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
  inspectOpenReferenceDocuments,
  toggleActiveArtboardBackgrounds,
  toggleActiveGroupArtboards,
  toggleActiveReferenceView,
  watchActiveReferenceDocument,
  type ReferenceDocumentState
} from "../photoshop/referenceViewController";
import { PLUGIN_VERSION } from "../pluginMetadata";
import type { PsdAiReference } from "../photoshop/psdAiReference";
import {
  applyPsdAiScopeScan,
  beginPsdAiScopeBackfill,
  createPsdAiScopeGate,
  finishPsdAiScopeBackfill,
  psdAiScopeNodeKey,
  shouldConfirmPsdAiScopeShrink
} from "../domain/psdAiScopeStability";
import { AiGenerationPanel } from "./AiGenerationPanel";
import { AiEditPanel } from "./AiEditPanel";
import { AiOutlinePanel } from "./AiOutlinePanel";
import { AiRefinePanel } from "./AiRefinePanel";
import { SpectrumSelect } from "./SpectrumSelect";
import { StandardGridPanel } from "./StandardGridPanel";
import type { PlacementMode } from "../photoshop/placementMode";
import { generateStandardGridPsd } from "../photoshop/StandardGridDocumentGenerator";
import { shouldShowAiDraftPanel } from "../domain/aiDraftVisibility";
import {
  CHESSGO_UPDATE_CHECK_INTERVAL_MS,
  CHESSGO_UPDATE_CHECK_MIN_GAP_MS,
  checkPluginUpdate,
  launchPluginUpdate
} from "../update/pluginUpdate";

type UiPhase =
  | "idle"
  | "importing"
  | "selectingSheet"
  | "parsingSheet"
  | "reviewing"
  | "exporting"
  | "diagnosing"
  | "generating"
  | "generatingGrid"
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

interface PluginUpdateUiState {
  status: "checking" | "current" | "available" | "error";
  latestVersion?: string;
  detail?: string;
}

const LARGE_WORKBOOK_BYTES = 250 * 1024 * 1024;
const MAX_LIVE_THUMBNAILS = 32;

function psdOnlyAssetCandidate(
  assetCode: string,
  sourceOrder: number,
  itemName?: string
): AssetCandidate {
  const underscore = assetCode.indexOf("_");
  return {
    key: `psd:${assetCode}`,
    assetCode,
    name: itemName?.trim() || assetCode,
    prefix: underscore >= 0 ? assetCode.slice(0, underscore + 1) : "",
    sheetName: "当前 PSD",
    codeCell: `PSD${sourceOrder + 1}`,
    codeRow: sourceOrder + 1,
    codeCol: 1,
    sourceGroupId: "psd",
    sourceOrder,
    imageCandidates: [],
    issues: [],
    selected: true
  };
}

export function App(): React.ReactElement {
  const [initialGenerationSettings] = useState(() => loadGenerationSettings());
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
  const [pluginUpdate, setPluginUpdate] = useState<PluginUpdateUiState>({
    status: "checking"
  });
  const [updateLaunching, setUpdateLaunching] = useState(false);
  const [updateLaunchHint, setUpdateLaunchHint] = useState("");
  const [referenceDocument, setReferenceDocument] = useState<ReferenceDocumentState | null>(null);
  const [activePhotoshopDocumentId, setActivePhotoshopDocumentId] = useState<number | null>(null);
  const [referenceBusy, setReferenceBusy] = useState(false);
  const [groupArtboardBusy, setGroupArtboardBusy] = useState(false);
  const [artboardBackgroundBusy, setArtboardBackgroundBusy] = useState<"color" | "visibility" | null>(null);
  const [editableCanvasSizeInput, setEditableCanvasSizeInput] = useState(
    String(initialGenerationSettings.editableCanvasSize)
  );
  const [generationSpacingInput, setGenerationSpacingInput] = useState(
    String(initialGenerationSettings.artboardSpacing)
  );
  const [batchImageFeedbackByGroup, setBatchImageFeedbackByGroup] = useState<Record<string, BatchImageFeedback>>({});
  const [collapsedItemGroupIds, setCollapsedItemGroupIds] = useState<string[]>([]);
  const [uiError, setUiError] = useState<UiError | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [editBusy, setEditBusy] = useState(false);
  const [outlineBusy, setOutlineBusy] = useState(false);
  const [refineBusy, setRefineBusy] = useState(false);
  const [gridBusy, setGridBusy] = useState(false);
  const [placementMode, setPlacementMode] = useState<PlacementMode>("UNSUPPORTED_CANVAS");
  const [retainedAiSourceDocument, setRetainedAiSourceDocument] = useState<ReferenceDocumentState | null>(null);
  const [recentWorkbook, setRecentWorkbook] = useState<RecentWorkbookRecord | null>(
    () => loadRecentWorkbookRecord()
  );
  const referenceScopeGate = useRef(createPsdAiScopeGate<ReferenceDocumentState>(null));
  const initialPsdLayoutApplied = useRef(false);
  const thumbnailCache = useMemo(() => new ThumbnailCache(MAX_LIVE_THUMBNAILS), []);
  const thumbnailRequests = useRef(new Set<string>());
  const thumbnailOrder = useRef<string[]>([]);
  const visibleThumbnailCounts = useRef(new Map<string, number>());
  const thumbnailSession = useRef(0);
  const thumbnailQueue = useRef<ThumbnailTask[]>([]);
  const thumbnailActiveCount = useRef(0);
  const updateCheckInFlight = useRef(false);
  const updateLastCheckedAt = useRef(0);

  const nonAiBusy =
    phase === "importing" || phase === "parsingSheet" || phase === "exporting" ||
    phase === "diagnosing" || phase === "generating" || phase === "generatingGrid";
  const busy = nonAiBusy || aiBusy || editBusy || outlineBusy || refineBusy || gridBusy;
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
  const aiSourceDocument = referenceDocument ?? retainedAiSourceDocument;
  const aiPsdReferences = useMemo<PsdAiReference[]>(
    () => aiSourceDocument?.aiNodes.map((node) => ({
      ...node,
      documentId: aiSourceDocument.documentId,
      documentName: aiSourceDocument.documentName,
      documentIdentity: aiSourceDocument.documentIdentity
    })) ?? [],
    [
      aiSourceDocument?.aiNodes,
      aiSourceDocument?.documentId,
      aiSourceDocument?.documentIdentity,
      aiSourceDocument?.documentName
    ]
  );
  const aiPsdItems = useMemo(() => aiPsdReferences.map((reference, index) => {
    const excelItem = items.find((item) => item.assetCode === reference.assetCode);
    return {
      ...(excelItem ?? psdOnlyAssetCandidate(reference.assetCode, index, reference.itemName)),
      name: excelItem?.name?.trim() || reference.itemName?.trim() || reference.assetCode,
      key: psdAiScopeNodeKey(reference.documentId, reference),
      sheetName: reference.groupLabel,
      codeCell: `PSD${index + 1}`,
      codeRow: index + 1,
      codeCol: 1,
      sourceGroupId: reference.groupId,
      sourceOrder: index,
      selected: true
    };
  }), [aiPsdReferences, items]);
  const aiPsdGroups = useMemo<SheetGroup[]>(() => {
    const groupsById = new Map<string, SheetGroup>();
    for (let index = 0; index < aiPsdReferences.length; index += 1) {
      const reference = aiPsdReferences[index]!;
      const row = index + 1;
      const existing = groupsById.get(reference.groupId);
      if (existing) {
        existing.endRow = row;
        existing.itemCount += 1;
        existing.physicalSegments[0]!.endRow = row;
        continue;
      }
      groupsById.set(reference.groupId, {
        id: reference.groupId,
        label: reference.groupLabel,
        sourceCell: "PSD",
        startRow: row,
        endRow: row,
        itemCount: 1,
        physicalSegments: [{ ref: "PSD", startRow: row, endRow: row }],
        inferredContinuation: false
      });
    }
    return Array.from(groupsById.values());
  }, [aiPsdReferences]);
  const aiDraftPanelVisible = shouldShowAiDraftPanel(activePhotoshopDocumentId, placementMode);
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
  const displayedLogs = formattedLogs || "尚无日志。";
  const logViewportHeight = useMemo(() => {
    const lineCount = displayedLogs.split(/\r?\n/).length;
    return Math.min(210, Math.max(34, lineCount * 16 + 18));
  }, [displayedLogs]);
  const handleOutlineStatus = useCallback((detail: string, level: "info" | "warn" | "error" = "info"): void => {
    setMessage(detail);
    if (level === "error") setShowDiagnostics(true);
    const event = makeLog(level, "centerline.ai", detail);
    setLogs((current) => [...current.slice(-199), event]);
    console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](event.event, event.detail ?? "");
  }, []);

  const handleImageEditorStatus = useCallback((detail: string, level: "info" | "warn" | "error" = "info"): void => {
    setMessage(detail);
    if (level === "error") setShowDiagnostics(true);
    const event = makeLog(level, "image-editor.ai", detail);
    setLogs((current) => [...current.slice(-199), event]);
    console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](event.event, event.detail ?? "");
  }, []);

  const handleImageRefinerStatus = useCallback((detail: string, level: "info" | "warn" | "error" = "info"): void => {
    setMessage(detail);
    if (level === "error") setShowDiagnostics(true);
    const event = makeLog(level, "image-refiner.ai", detail);
    setLogs((current) => [...current.slice(-199), event]);
    console[level === "error" ? "error" : level === "warn" ? "warn" : "log"](event.event, event.detail ?? "");
  }, []);

  const checkForPluginRelease = useCallback(async (force = false): Promise<void> => {
    if (updateCheckInFlight.current) return;
    if (
      !force &&
      Date.now() - updateLastCheckedAt.current < CHESSGO_UPDATE_CHECK_MIN_GAP_MS
    ) {
      return;
    }
    updateCheckInFlight.current = true;
    setPluginUpdate((current) => (
      current.status === "available" ? current : { status: "checking" }
    ));
    try {
      const result = await checkPluginUpdate();
      setPluginUpdate({
        status: result.updateAvailable ? "available" : "current",
        latestVersion: result.latestVersion
      });
    } catch (error) {
      const detail = toErrorMessage(error);
      setPluginUpdate((current) => (
        current.status === "available"
          ? current
          : { status: "error", detail }
      ));
    } finally {
      updateLastCheckedAt.current = Date.now();
      updateCheckInFlight.current = false;
    }
  }, []);

  const commitReferenceDocument = useCallback((next: ReferenceDocumentState | null): void => {
    referenceScopeGate.current = {
      ...referenceScopeGate.current,
      visible: next
    };
    setReferenceDocument(next);
  }, []);

  const handleReferenceDocumentScan = useCallback((next: ReferenceDocumentState | null): void => {
    const previous = referenceScopeGate.current;
    const updated = applyPsdAiScopeScan(previous, next);
    referenceScopeGate.current = updated;
    if (updated.visible !== previous.visible) setReferenceDocument(updated.visible);
  }, []);

  const handlePsdBackfillStart = useCallback((documentId: number): void => {
    referenceScopeGate.current = beginPsdAiScopeBackfill(referenceScopeGate.current, documentId);
  }, []);

  const handlePsdBackfillSettled = useCallback(async (
    replacementMayHaveMutated: boolean
  ): Promise<void> => {
    const locked = referenceScopeGate.current;
    if (!locked.lock) return;
    try {
      const retryDelays = replacementMayHaveMutated
        ? [0, 80, 120, 200, 400]
        : [0, 80];
      let inspected: ReferenceDocumentState | null = null;
      for (const delay of retryDelays) {
        if (delay) await new Promise<void>((resolve) => window.setTimeout(resolve, delay));
        inspected = await inspectActiveReferenceDocument();
        if (!shouldConfirmPsdAiScopeShrink(locked, inspected)) break;
      }
      const finished = finishPsdAiScopeBackfill(referenceScopeGate.current, inspected);
      referenceScopeGate.current = finished;
      setReferenceDocument(finished.visible);
    } catch (error) {
      referenceScopeGate.current = {
        ...referenceScopeGate.current,
        lock: null
      };
      throw error;
    }
  }, []);

  useEffect(
    () => watchActiveReferenceDocument(handleReferenceDocumentScan, setActivePhotoshopDocumentId),
    [handleReferenceDocumentScan]
  );

  useEffect(() => {
    void checkForPluginRelease();
    const intervalId = window.setInterval(
      () => void checkForPluginRelease(),
      CHESSGO_UPDATE_CHECK_INTERVAL_MS
    );
    const handleWindowFocus = (): void => {
      void checkForPluginRelease();
    };
    window.addEventListener("focus", handleWindowFocus);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", handleWindowFocus);
    };
  }, [checkForPluginRelease]);

  useEffect(() => {
    const editableCanvasSize = Number(editableCanvasSizeInput);
    const artboardSpacing = Number(generationSpacingInput);
    if (!isValidEditableCanvasSize(editableCanvasSize) || !isValidArtboardSpacing(artboardSpacing)) return;
    saveGenerationSettings({
      version: 1,
      editableCanvasSize,
      artboardSpacing
    });
  }, [editableCanvasSizeInput, generationSpacingInput]);

  useEffect(() => {
    if (!referenceDocument || initialPsdLayoutApplied.current) return;
    initialPsdLayoutApplied.current = true;
    setShowCurrentPsd(true);
    setShowGenerator(false);
  }, [referenceDocument]);

  useEffect(() => {
    if (referenceDocument?.aiNodes.length) setRetainedAiSourceDocument(referenceDocument);
  }, [referenceDocument]);

  useEffect(() => {
    if (
      placementMode !== "STANDARD_GRID"
      || activePhotoshopDocumentId === null
      || aiSourceDocument?.aiNodes.length
    ) return;
    let disposed = false;
    void inspectOpenReferenceDocuments(activePhotoshopDocumentId).then((sources) => {
      if (disposed) return;
      const source = sources.find((candidate) => candidate.aiNodes.length > 0);
      if (source) setRetainedAiSourceDocument(source);
    });
    return () => { disposed = true; };
  }, [activePhotoshopDocumentId, aiSourceDocument?.documentId, placementMode]);

  const pruneInactiveThumbnails = useCallback((
    current: Record<string, ThumbnailRecord>,
    protectedEntry?: string
  ): Record<string, ThumbnailRecord> => {
    let next = current;
    while (thumbnailOrder.current.length > MAX_LIVE_THUMBNAILS) {
      const evictionIndex = thumbnailOrder.current.findIndex((entry) =>
        entry !== protectedEntry && !visibleThumbnailCounts.current.has(entry)
      );
      if (evictionIndex < 0) break;
      const [oldest] = thumbnailOrder.current.splice(evictionIndex, 1);
      if (!oldest) break;
      if (next === current) next = { ...current };
      delete next[oldest];
      thumbnailRequests.current.delete(oldest);
      thumbnailCache.delete(oldest);
    }
    return next;
  }, [thumbnailCache]);

  const commitThumbnailRecord = useCallback((entry: string, record: ThumbnailRecord): void => {
    setThumbnails((current) => {
      const next = { ...current, [entry]: record };
      if (record.state === "ready" || record.state === "error") {
        thumbnailOrder.current = thumbnailOrder.current.filter((value) => value !== entry);
        thumbnailOrder.current.push(entry);
      }
      return pruneInactiveThumbnails(next, entry);
    });
  }, [pruneInactiveThumbnails]);

  const handleThumbnailVisibility = useCallback((entry: string, visible: boolean): void => {
    const previous = visibleThumbnailCounts.current.get(entry) ?? 0;
    if (visible) {
      visibleThumbnailCounts.current.set(entry, previous + 1);
      return;
    }
    if (previous > 1) {
      visibleThumbnailCounts.current.set(entry, previous - 1);
      return;
    }
    visibleThumbnailCounts.current.delete(entry);
    setThumbnails((current) => pruneInactiveThumbnails(current));
  }, [pruneInactiveThumbnails]);

  const resetThumbnailPreviews = useCallback((): void => {
    thumbnailSession.current += 1;
    thumbnailRequests.current.clear();
    thumbnailOrder.current = [];
    visibleThumbnailCounts.current.clear();
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

  async function handleLaunchPluginUpdate(): Promise<void> {
    if (pluginUpdate.status !== "available" || updateLaunching || busy) return;
    setUpdateLaunching(true);
    setUpdateLaunchHint("");
    try {
      const result = await launchPluginUpdate((progress) => {
        appendLog(makeLog(
          progress.kind === "error" ? "error" : "info",
          "plugin.update.progress",
          progress.message
        ));
      });
      setMessage(result.message);
      if (result.outcome === "error") {
        setUpdateLaunchHint(result.message);
      }
    } catch (error) {
      const detail = `启动更新失败：${toErrorMessage(error)}`;
      setUpdateLaunchHint(detail);
      setMessage(detail);
      appendLog(makeLog("error", "plugin.update.launch.failed", detail));
    } finally {
      setUpdateLaunching(false);
    }
  }

  function toggleDiagnostics(): void {
    if (!showDiagnostics) void checkForPluginRelease();
    setShowDiagnostics((value) => !value);
  }

  async function handleGenerate(): Promise<void> {
    if (!workbook) return;
    const editableCanvasSize = Number(editableCanvasSizeInput);
    if (!isValidEditableCanvasSize(editableCanvasSize)) {
      const detail = `智能对象边长请输入 ${MIN_EDITABLE_CANVAS_SIZE}–${MAX_EDITABLE_CANVAS_SIZE} 之间的整数。`;
      setMessage(detail);
      presentError(detail, "generator");
      return;
    }
    const spacing = Number(generationSpacingInput);
    if (!isValidArtboardSpacing(spacing)) {
      const detail = `画板间距请输入 ${MIN_ARTBOARD_SPACING}–${MAX_ARTBOARD_SPACING} 之间的整数。`;
      setMessage(detail);
      presentError(detail, "generator");
      return;
    }
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
        editableCanvasSize,
        template: {
          ...DEFAULT_TEMPLATE,
          artboard: {
            ...DEFAULT_TEMPLATE.artboard,
            gapX: spacing,
            gapY: spacing
          }
        },
        suggestedBaseName: defaultBatchBaseName(workbook.sourceName, sheetName),
        onProgress: ({ stage, completed, total }) => {
          setProgress({ completed, total });
          setMessage(`${stage}（${completed}/${total}）`);
        }
      });
      commitReferenceDocument(await inspectActiveReferenceDocument());
      setPhase("done");
      setShowCurrentPsd(true);
      setShowGenerator(false);
      setMessage(`生成完成：${results.length} 个 PSD。`);
      appendLog(makeLog("info", "batch.generation.completed", `${results.length} volumes`));
    } catch (error) {
      handleError(error, "批量生成失败");
    }
  }

  async function handleGenerateStandardGrid(): Promise<void> {
    if (busy) return;
    setUiError(null);
    setPhase("generatingGrid");
    setMessage("请选择标准网格 PSD 的保存位置……");
    appendLog(makeLog("info", "standard-grid.generation.started"));
    try {
      const result = await generateStandardGridPsd();
      setPhase("done");
      setActivePhotoshopDocumentId(result.documentId);
      setPlacementMode("STANDARD_GRID");
      setMessage(`标准网格画布已生成：${result.fileName}`);
      appendLog(makeLog("info", "standard-grid.generation.completed", result.fileName));
    } catch (error) {
      handleError(error, "生成标准网格画布失败");
    }
  }

  async function handleReferenceViewToggle(): Promise<void> {
    if (!referenceDocument || referenceBusy || groupArtboardBusy || artboardBackgroundBusy) return;
    setUiError((current) => current?.area === "currentPsd" ? null : current);
    setReferenceBusy(true);
    try {
      const next = await toggleActiveReferenceView();
      commitReferenceDocument(next);
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
      commitReferenceDocument(next);
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
      commitReferenceDocument(result.state);
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
      commitReferenceDocument(next);
      const detail = next?.artboardBackgroundsVisible ? "已显示全部底板。" : "已隐藏全部底板。";
      setMessage(detail);
      appendLog(makeLog("info", "artboard-background.visibility.toggled", next?.artboardBackgroundsVisible ? "visible" : "hidden"));
    } catch (error) {
      const detail = toErrorMessage(error);
      const errorMessage = `底板切换失败：${detail}`;
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
              {referenceDocument.referenceCount > 0 || referenceDocument.groupArtboardsAvailable ? (
                <div className="reference-control-actions">
                  {referenceDocument.referenceCount > 0 ? (
                    <button
                      className="compact"
                      disabled={busy || referenceBusy || groupArtboardBusy || Boolean(artboardBackgroundBusy) || !referenceDocument.supported}
                      onClick={() => void handleReferenceViewToggle()}
                    >
                      {referenceBusy
                        ? "正在切换……"
                        : referenceDocument.referenceVisible ? "隐藏参考图" : "仅显示参考图"}
                    </button>
                  ) : null}
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
              ) : null}
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
                      : referenceDocument.artboardBackgroundsVisible ? "隐藏底板" : "显示底板"}
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

      <StandardGridPanel
        activeDocumentId={activePhotoshopDocumentId}
        externalBusy={nonAiBusy || aiBusy || editBusy || outlineBusy || refineBusy || referenceBusy || groupArtboardBusy || Boolean(artboardBackgroundBusy)}
        onBusyChange={setGridBusy}
        onModeChange={setPlacementMode}
        onStatus={(detail, level = "info") => {
          setMessage(detail);
          appendLog(makeLog(level, "standard-grid", detail));
        }}
      />

      <div
        className="ai-panel-host"
        style={{ display: aiDraftPanelVisible ? "block" : "none" }}
        aria-hidden={!aiDraftPanelVisible}
      >
        <AiGenerationPanel
          workbook={workbook}
          activeGroups={aiPsdGroups}
          items={aiPsdItems}
          psdReferences={aiPsdReferences}
          placementMode={placementMode}
          activeDocumentId={activePhotoshopDocumentId}
          thumbnails={thumbnails}
          externalBusy={
            nonAiBusy || editBusy || outlineBusy || refineBusy || gridBusy || referenceBusy || groupArtboardBusy || Boolean(artboardBackgroundBusy)
          }
          requestThumbnail={requestThumbnail}
          onThumbnailError={handleThumbnailDecodeError}
          onStatus={(detail, level = "info") => {
            setMessage(detail);
            appendLog(makeLog(level, "holopix.ai", detail));
          }}
          onBusyChange={setAiBusy}
          onPsdBackfillStart={handlePsdBackfillStart}
          onPsdBackfillSettled={handlePsdBackfillSettled}
        />
      </div>

      <div
        className="ai-panel-host"
        style={{ display: activePhotoshopDocumentId !== null ? "block" : "none" }}
        aria-hidden={activePhotoshopDocumentId === null}
      >
        <AiEditPanel
          externalBusy={
            nonAiBusy || aiBusy || outlineBusy || refineBusy || gridBusy || referenceBusy || groupArtboardBusy || Boolean(artboardBackgroundBusy)
          }
          onBusyChange={setEditBusy}
          onStatus={handleImageEditorStatus}
        />
      </div>

      <div
        className="ai-panel-host"
        style={{ display: activePhotoshopDocumentId !== null ? "block" : "none" }}
        aria-hidden={activePhotoshopDocumentId === null}
      >
        <AiOutlinePanel
          activeDocumentId={activePhotoshopDocumentId}
          externalBusy={
            nonAiBusy || aiBusy || editBusy || refineBusy || gridBusy || referenceBusy || groupArtboardBusy || Boolean(artboardBackgroundBusy)
          }
          onBusyChange={setOutlineBusy}
          onStatus={handleOutlineStatus}
        />
      </div>

      <div
        className="ai-panel-host"
        style={{ display: activePhotoshopDocumentId !== null ? "block" : "none" }}
        aria-hidden={activePhotoshopDocumentId === null}
      >
        <AiRefinePanel
          externalBusy={
            nonAiBusy || aiBusy || editBusy || outlineBusy || gridBusy || referenceBusy || groupArtboardBusy || Boolean(artboardBackgroundBusy)
          }
          onBusyChange={setRefineBusy}
          onStatus={handleImageRefinerStatus}
        />
      </div>

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

      <button
        type="button"
        className="primary"
        disabled={busy}
        onClick={() => void handleGenerateStandardGrid()}
      >
        {phase === "generatingGrid" ? "正在生成网格画布……" : "生成网格画布"}
      </button>

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
            <SpectrumSelect
              ariaLabel="工作表"
              value={sheetName}
              disabled={busy}
              options={workbook.reader.index.sheets.map((sheet) => ({
                value: sheet.name,
                label: `${sheet.name}${sheet.state !== "visible" ? `（${sheet.state}）` : ""}`
              }))}
              onValueChange={handleSheetChange}
            />
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
            <div className="generation-setting-control">
              <label className="generation-setting-label" htmlFor="editable-canvas-size">
                智能对象边长
              </label>
              <div className="generation-setting-field">
                <input
                  id="editable-canvas-size"
                  className="generation-setting-input"
                  type="number"
                  min={MIN_EDITABLE_CANVAS_SIZE}
                  max={MAX_EDITABLE_CANVAS_SIZE}
                  step="1"
                  placeholder={String(DEFAULT_EDITABLE_CANVAS_SIZE)}
                  aria-label="生成空白智能对象的正方形边长"
                  value={editableCanvasSizeInput}
                  disabled={busy}
                  onChange={(event) => setEditableCanvasSizeInput(event.currentTarget.value)}
                />
                <span className="generation-setting-unit">px</span>
              </div>
            </div>
            <div className="generation-setting-control">
              <label className="generation-setting-label" htmlFor="generation-spacing">
                画板间距
              </label>
              <div className="generation-setting-field">
                <input
                  id="generation-spacing"
                  className="generation-setting-input"
                  type="number"
                  min={MIN_ARTBOARD_SPACING}
                  max={MAX_ARTBOARD_SPACING}
                  step="1"
                  aria-label="生成画板的横向和纵向间距"
                  value={generationSpacingInput}
                  disabled={busy}
                  onChange={(event) => setGenerationSpacingInput(event.currentTarget.value)}
                />
                <span className="generation-setting-unit">px</span>
              </div>
            </div>
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
                      key={representativeChoice.representative.anchor.archiveEntry}
                      className="batch-thumbnail"
                      record={representativeThumbnail}
                      alt={`第 ${representativeChoice.rowOffset} 排代表图`}
                      onVisible={() => requestThumbnail(representativeChoice.representative.anchor.archiveEntry)}
                      onVisibilityChange={(visible) => handleThumbnailVisibility(
                        representativeChoice.representative.anchor.archiveEntry,
                        visible
                      )}
                      onError={() => handleThumbnailDecodeError(representativeChoice.representative.anchor.archiveEntry)}
                    />
                    <div className="batch-image-control-copy">
                      <span className="batch-image-title">批量选图</span>
                      <SpectrumSelect
                        ariaLabel={`${group.label}批量选图`}
                        disabled={busy}
                        value={selectedRowOffset === undefined ? "" : String(selectedRowOffset)}
                        options={[
                          ...(selectedRowOffset === undefined
                            ? [{ value: "", label: "选择图片排位" }]
                            : []),
                          ...rowChoices.map((choice) => ({
                            value: String(choice.rowOffset),
                            label: `第 ${choice.rowOffset} 排 · ${choice.coverage}/${groupItems.length}`
                          }))
                        ]}
                        onValueChange={(value) => {
                          const rowOffset = Number(value);
                          if (Number.isFinite(rowOffset)) handleBatchImageRowChoice(group.id, groupItems, rowOffset);
                        }}
                      />
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
                                onVisibilityChange={(visible) => handleThumbnailVisibility(
                                  candidate.anchor.archiveEntry,
                                  visible
                                )}
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
                            <span className="thumb-placeholder">无关联图片</span>
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
          onClick={toggleDiagnostics}
          onKeyDown={(event) => handleDisclosureKey(event, toggleDiagnostics)}
        >
          <span className={`panel-disclosure ${showDiagnostics ? "is-open" : ""}`} aria-hidden="true">
            {showDiagnostics ? "⌄" : ">"}
          </span>
          <span>运行与诊断</span>
          {pluginUpdate.status === "available" ? (
            <span className="diagnostics-update-badge">（有新版本）</span>
          ) : null}
        </div>
        {showDiagnostics ? (
          <div className="panel-section-content diagnostics-content">
          <div className={`diagnostics-update-card is-${pluginUpdate.status}`}>
            <div className="diagnostics-update-heading">
              <strong>插件更新</strong>
              <small>当前版本 {PLUGIN_VERSION}</small>
            </div>
            {pluginUpdate.status === "checking" ? (
              <span className="diagnostics-update-detail">正在检查 release……</span>
            ) : null}
            {pluginUpdate.status === "current" ? (
              <>
                <span className="diagnostics-update-detail">
                  当前已是最新版本
                  {pluginUpdate.latestVersion === PLUGIN_VERSION
                    ? `（${pluginUpdate.latestVersion}）`
                    : pluginUpdate.latestVersion
                      ? `；远端 release 为 ${pluginUpdate.latestVersion}`
                      : ""}。
                </span>
                <button
                  className="compact diagnostics-update-recheck"
                  disabled={updateCheckInFlight.current}
                  onClick={() => void checkForPluginRelease(true)}
                >
                  重新检查
                </button>
              </>
            ) : null}
            {pluginUpdate.status === "error" ? (
              <>
                <span className="diagnostics-update-detail is-error">
                  {pluginUpdate.detail || "暂时无法检查更新。"}
                </span>
                <button
                  className="compact diagnostics-update-recheck"
                  onClick={() => void checkForPluginRelease(true)}
                >
                  重试检查
                </button>
              </>
            ) : null}
            {pluginUpdate.status === "available" ? (
              <>
                <span className="diagnostics-update-detail">
                  发现 {pluginUpdate.latestVersion}。
                </span>
                <button
                  className="primary diagnostics-update-action"
                  disabled={busy || updateLaunching}
                  onClick={() => void handleLaunchPluginUpdate()}
                >
                  {updateLaunching ? "正在更新……" : "更新棋子go"}
                </button>
              </>
            ) : null}
            {updateLaunchHint ? (
              <span className="diagnostics-update-detail">{updateLaunchHint}</span>
            ) : null}
          </div>
          <div className="log-actions">
            <button className="compact" disabled={busy || !scopedItems.length} onClick={() => void handleExportManifest()}>
              {phase === "exporting" ? "正在导出……" : "导出解析 Manifest"}
            </button>
            <button className="compact" disabled={busy || (!logs.length && !workbook)} onClick={() => void handleExportDiagnostics()}>
              {phase === "diagnosing" ? "正在打包……" : "导出诊断包"}
            </button>
          </div>
            <textarea
              className="logs"
              readOnly
              aria-label="运行日志，可选择并复制"
              value={displayedLogs}
              style={{ height: `${logViewportHeight}px` }}
            />
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
  onVisibilityChange: (visible: boolean) => void;
  onError: () => void;
}

function LazyThumbnail({
  className,
  record,
  alt,
  onVisible,
  onVisibilityChange,
  onError
}: LazyThumbnailProps): React.ReactElement {
  const rootRef = useRef<HTMLSpanElement | null>(null);
  const onVisibleRef = useRef(onVisible);
  const onVisibilityChangeRef = useRef(onVisibilityChange);
  const recordStateRef = useRef(record?.state);
  const visibleRef = useRef(false);
  onVisibleRef.current = onVisible;
  onVisibilityChangeRef.current = onVisibilityChange;
  recordStateRef.current = record?.state;

  useEffect(() => {
    const element = rootRef.current;
    const setVisible = (visible: boolean): void => {
      if (visibleRef.current === visible) return;
      visibleRef.current = visible;
      onVisibilityChangeRef.current(visible);
      if (visible && !recordStateRef.current) onVisibleRef.current();
    };
    if (!element || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return () => setVisible(false);
    }
    const observer = new IntersectionObserver((entries) => {
      setVisible(entries.some((entry) => entry.isIntersecting));
    }, { root: null, rootMargin: "180px 0px" });
    observer.observe(element);
    return () => {
      observer.disconnect();
      setVisible(false);
    };
  }, []);

  useEffect(() => {
    if (!record?.state && visibleRef.current) onVisibleRef.current();
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
