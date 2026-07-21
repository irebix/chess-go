import { action, app, core } from "photoshop";
import {
  hideGroupArtboards,
  inspectGroupArtboardOverlay,
  readStoredGroupLayout,
  showGroupArtboards
} from "./groupArtboardOverlay";
import {
  applyStoredArtboardBackgrounds,
  choosePhotoshopForegroundColor,
  inspectArtboardBackgrounds,
  setArtboardBackgroundColor,
  setArtboardBackgroundVisibility
} from "./artboardBackgroundController";
import {
  listPsdAiTargetNodes,
  scopePsdAiTargetNodes,
  type PsdAiScopedNode
} from "./aiCandidateTarget";
import { accumulatePsdAiWatcherRefreshForce } from "../domain/psdAiScopeStability";
import { psdDocumentIdentity } from "./psdDocumentIdentity";

export const REFERENCE_LAYER_NAME = "参考图";
const EDITABLE_CANVAS_LAYER_NAME_PATTERN = /^\d+x\d+_空白智能对象$/;

export function editableCanvasLayerName(size: number): string {
  return `${size}x${size}_空白智能对象`;
}

const REFERENCE_COMP_NAME = "棋子归档｜仅参考图";
const RESTORE_COMP_NAME = "棋子归档｜恢复点";
const REFERENCE_COMMENT_PREFIX = "psd-archive-reference:v1";
const RESTORE_COMMENT = "psd-archive-reference-restore:v1";
const DOCUMENT_EVENTS = ["open", "close", "select", "show", "hide", "make", "delete", "move", "set", "save"];

function runOptionalPromise(operation: () => void | Promise<void>): Promise<void> {
  try {
    return Promise.resolve(operation());
  } catch {
    return Promise.resolve();
  }
}

type ReferenceMode = "normal" | "reference";

interface LayerLike {
  id: number;
  name: string;
  visible: boolean;
  layers?: LayerCollectionLike;
}

interface LayerCollectionLike {
  length: number;
  [index: number]: LayerLike;
}

interface LayerCompLike {
  name: string;
  comment: string;
  visibility: boolean;
  position: boolean;
  appearance: boolean;
  apply(): Promise<void>;
  recapture(): Promise<void>;
}

interface LayerCompCollectionLike {
  length: number;
  [index: number]: LayerCompLike;
  add(options: {
    name: string;
    comment?: string;
    visibility?: boolean;
    position?: boolean;
    appearance?: boolean;
  }): Promise<LayerCompLike>;
}

interface DocumentLike {
  id: number;
  name: string;
  path?: string;
  cloudDocument?: boolean;
  layers: LayerCollectionLike;
  artboards?: LayerCollectionLike;
  layerComps?: LayerCompCollectionLike;
}

interface ReferenceScan {
  artboards: LayerLike[];
  referenceLayers: LayerLike[];
  legacyReferenceLayers: LayerLike[];
}

interface ReferenceComment {
  mode: ReferenceMode;
  artboards?: number;
  references?: number;
}

export interface ReferenceDocumentState {
  documentId: number;
  documentName: string;
  documentIdentity: string;
  artboardCount: number;
  referenceCount: number;
  referenceVisible: boolean;
  mode: ReferenceMode;
  supported: boolean;
  groupArtboardsAvailable: boolean;
  groupArtboardsVisible: boolean;
  artboardBackgroundsAvailable: boolean;
  artboardBackgroundsVisible: boolean;
  artboardBackgroundCount: number;
  aiAssetCodes: string[];
  aiNodes: PsdAiNode[];
}

export type PsdAiNode = PsdAiScopedNode;

export interface ArtboardBackgroundColorChangeResult {
  state: ReferenceDocumentState;
  changed: boolean;
}

export async function inspectActiveReferenceDocument(): Promise<ReferenceDocumentState | null> {
  const document = activeDocument();
  if (!document) return null;
  return inspectDocument(document);
}

export async function toggleActiveReferenceView(): Promise<ReferenceDocumentState | null> {
  const document = activeDocument();
  if (!document) throw new Error("当前没有打开的 PSD 文档。");

  const before = inspectDocument(document);
  if (!before) throw new Error("当前 PSD 中没有识别到参考图。");
  if (!before.supported) throw new Error("参考图持久切换需要 Photoshop 2023 或更高版本。");
  const shouldHide = before.mode === "reference" || before.referenceVisible;
  const groupArtboardsBefore = inspectGroupArtboardOverlay(document);

  await core.executeAsModal(
    async () => {
      if (before.mode === "reference") await restorePreviousView(document);
      else if (before.referenceVisible) await hideCurrentReferences(document);
      else await enterReferenceView(document);
      await restoreGroupArtboardState(document, groupArtboardsBefore.visible);
      await applyStoredArtboardBackgrounds(document);
      await recaptureReferenceMode(document, shouldHide ? "normal" : "reference");
    },
    { commandName: shouldHide ? "隐藏参考图" : "仅显示参考图" }
  );

  return inspectDocument(document);
}

export async function toggleActiveGroupArtboards(): Promise<ReferenceDocumentState | null> {
  const document = activeDocument();
  if (!document) throw new Error("当前没有打开的 PSD 文档。");
  const overlay = inspectGroupArtboardOverlay(document);
  if (!overlay.available) throw new Error("当前 PSD 中没有分组画板数据。");
  const shouldShow = !overlay.visible;

  await core.executeAsModal(
    async () => {
      if (shouldShow) await showGroupArtboards(document);
      else await hideGroupArtboards(document);
    },
    { commandName: shouldShow ? "显示分组框" : "隐藏分组框" }
  );
  return inspectDocument(document);
}

export async function toggleActiveArtboardBackgrounds(): Promise<ReferenceDocumentState | null> {
  const document = activeDocument();
  if (!document) throw new Error("当前没有打开的 PSD 文档。");
  const before = inspectDocument(document);
  if (!before?.artboardBackgroundsAvailable) throw new Error("当前 PSD 中没有识别到底板设置。");
  const shouldShow = !before.artboardBackgroundsVisible;

  await core.executeAsModal(
    async () => {
      await setArtboardBackgroundVisibility(document, shouldShow);
      await recaptureReferenceMode(document, before.mode);
    },
    { commandName: shouldShow ? "显示底板" : "隐藏底板" }
  );
  return inspectDocument(document);
}

export async function changeActiveArtboardBackgroundColor(): Promise<ArtboardBackgroundColorChangeResult> {
  const document = activeDocument();
  if (!document) throw new Error("当前没有打开的 PSD 文档。");
  const before = inspectDocument(document);
  if (!before?.artboardBackgroundsAvailable) throw new Error("当前 PSD 中没有识别到底板设置。");

  const color = await choosePhotoshopForegroundColor();
  if (!color) return { state: before, changed: false };
  await core.executeAsModal(
    async () => {
      await setArtboardBackgroundColor(document, color);
    },
    { commandName: "修改底板颜色" }
  );
  const state = inspectDocument(document);
  if (!state) throw new Error("更新颜色后无法重新识别当前 PSD。");
  return { state, changed: true };
}

export async function initializeGeneratedReferenceView(documentValue: unknown): Promise<void> {
  const document = documentValue as DocumentLike;
  const collection = layerComps(document);
  if (!collection) return;

  const scan = scanReferences(document, false);
  if (!scan.referenceLayers.length) return;

  const restoreComp = await captureLayerComp(collection, RESTORE_COMP_NAME, RESTORE_COMMENT);
  applyReferenceOnlyVisibility(document, scan);
  const referenceComp = await captureLayerComp(
    collection,
    REFERENCE_COMP_NAME,
    referenceComment("reference", scan)
  );
  await restoreComp.apply();
  referenceComp.comment = referenceComment("normal", scan);
}

export function watchActiveReferenceDocument(
  onChange: (state: ReferenceDocumentState | null) => void,
  onActiveDocumentChange?: (documentId: number | null) => void
): () => void {
  let disposed = false;
  let timer: number | undefined;
  let lastDocumentId: number | null | undefined;
  let pendingForce = false;
  let consecutiveFailures = 0;

  const refresh = async (force: boolean): Promise<void> => {
    if (disposed) return;
    const document = activeDocument();
    const documentId = document?.id ?? null;
    if (!force && documentId === lastDocumentId) return;
    if (!disposed) onActiveDocumentChange?.(documentId);
    let state: ReferenceDocumentState | null;
    try {
      state = document ? inspectDocument(document) : null;
    } catch (error) {
      lastDocumentId = undefined;
      throw error;
    }
    lastDocumentId = documentId;
    if (!disposed) onChange(state);
  };

  const schedule = (force: boolean): void => {
    pendingForce = accumulatePsdAiWatcherRefreshForce(pendingForce, force);
    if (timer !== undefined) window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      timer = undefined;
      const refreshForce = pendingForce;
      pendingForce = false;
      void refresh(refreshForce).then(
        () => { consecutiveFailures = 0; },
        () => {
          consecutiveFailures += 1;
          if (!disposed && consecutiveFailures <= 2) schedule(true);
        }
      );
    }, 80);
  };

  const listener = (eventName: string): void => {
    schedule(eventName !== "select");
  };
  const focusListener = (): void => schedule(true);
  const registration = runOptionalPromise(
    () => action.addNotificationListener(DOCUMENT_EVENTS, listener) as unknown as void | Promise<void>
  );
  window.addEventListener("focus", focusListener);
  void refresh(true).catch(() => schedule(true));

  return () => {
    disposed = true;
    if (timer !== undefined) window.clearTimeout(timer);
    window.removeEventListener("focus", focusListener);
    void registration.then(() =>
      runOptionalPromise(
        () => action.removeNotificationListener(DOCUMENT_EVENTS, listener) as unknown as void | Promise<void>
      )
    );
  };
}

function activeDocument(): DocumentLike | null {
  try {
    if (!app.documents.length) return null;
    return app.activeDocument as unknown as DocumentLike;
  } catch {
    return null;
  }
}

function inspectDocument(document: DocumentLike): ReferenceDocumentState | null {
  const scan = scanReferences(document, true);
  const groupArtboards = inspectGroupArtboardOverlay(document);
  const artboardBackgrounds = inspectArtboardBackgrounds(document);
  if (!scan.referenceLayers.length && !groupArtboards.available && !artboardBackgrounds.available) return null;

  const collection = layerComps(document);
  const referenceComp = collection ? findLayerComp(collection, REFERENCE_COMP_NAME) : undefined;
  const restoreComp = collection ? findLayerComp(collection, RESTORE_COMP_NAME) : undefined;
  const comment = parseReferenceComment(referenceComp?.comment);
  const mode = comment?.mode === "reference" && restoreComp ? "reference" : "normal";
  const aiNodes = inspectPsdAiNodes(document);

  return {
    documentId: document.id,
    documentName: document.name,
    documentIdentity: psdDocumentIdentity(document),
    artboardCount: Math.max(scan.artboards.length, artboardBackgrounds.count),
    referenceCount: scan.referenceLayers.length,
    referenceVisible: scan.referenceLayers.some((layer) => layer.visible),
    mode,
    supported: Boolean(collection),
    groupArtboardsAvailable: groupArtboards.available,
    groupArtboardsVisible: groupArtboards.visible,
    artboardBackgroundsAvailable: artboardBackgrounds.available,
    artboardBackgroundsVisible: artboardBackgrounds.visible,
    artboardBackgroundCount: artboardBackgrounds.count,
    aiAssetCodes: aiNodes.map((node) => node.assetCode),
    aiNodes
  };
}

function inspectPsdAiNodes(document: DocumentLike): PsdAiNode[] {
  const groups = readStoredGroupLayout(document);
  const expectedArtboardIds = groups.flatMap((group) =>
    group.members.map((member) => member.artboardId)
  );
  const nodes = listPsdAiTargetNodes(
    document,
    REFERENCE_LAYER_NAME,
    expectedArtboardIds.length ? expectedArtboardIds : undefined
  );
  return scopePsdAiTargetNodes(document.id, nodes, groups);
}

async function enterReferenceView(document: DocumentLike): Promise<void> {
  const collection = layerComps(document);
  if (!collection) throw new Error("当前 Photoshop 版本不支持图层复合。");

  const scan = scanReferences(document, true);
  if (!scan.referenceLayers.length) throw new Error("当前 PSD 中没有识别到参考图。");
  for (const layer of scan.legacyReferenceLayers) layer.name = REFERENCE_LAYER_NAME;

  await captureLayerComp(collection, RESTORE_COMP_NAME, RESTORE_COMMENT);

  let referenceComp = findLayerComp(collection, REFERENCE_COMP_NAME);
  const saved = parseReferenceComment(referenceComp?.comment);
  const structureChanged = saved?.artboards !== scan.artboards.length ||
    saved?.references !== scan.referenceLayers.length;

  if (!referenceComp || structureChanged) {
    applyReferenceOnlyVisibility(document, scan);
    referenceComp = await captureLayerComp(
      collection,
      REFERENCE_COMP_NAME,
      referenceComment("reference", scan)
    );
  } else {
    await referenceComp.apply();
  }
  if (!referenceComp) throw new Error("无法建立参考图显示状态。");
  referenceComp.comment = referenceComment("reference", scan);
}

async function restorePreviousView(document: DocumentLike): Promise<void> {
  const collection = layerComps(document);
  if (!collection) throw new Error("当前 Photoshop 版本不支持图层复合。");
  const restoreComp = findLayerComp(collection, RESTORE_COMP_NAME);
  if (!restoreComp) throw new Error("当前 PSD 中缺少可恢复的显示状态。");

  await restoreComp.apply();
  const scan = scanReferences(document, true);
  for (const referenceLayer of scan.referenceLayers) referenceLayer.visible = false;
  restoreComp.visibility = true;
  restoreComp.position = false;
  restoreComp.appearance = false;
  await restoreComp.recapture();
  const referenceComp = findLayerComp(collection, REFERENCE_COMP_NAME);
  if (referenceComp) referenceComp.comment = referenceComment("normal", scan);
}

async function hideCurrentReferences(document: DocumentLike): Promise<void> {
  const collection = layerComps(document);
  if (!collection) throw new Error("当前 Photoshop 版本不支持图层复合。");
  const scan = scanReferences(document, true);
  if (!scan.referenceLayers.length) throw new Error("当前 PSD 中没有识别到参考图。");
  for (const layer of scan.legacyReferenceLayers) layer.name = REFERENCE_LAYER_NAME;
  for (const referenceLayer of scan.referenceLayers) referenceLayer.visible = false;
  await captureLayerComp(collection, RESTORE_COMP_NAME, RESTORE_COMMENT);
  const referenceComp = findLayerComp(collection, REFERENCE_COMP_NAME);
  if (referenceComp) referenceComp.comment = referenceComment("normal", scan);
}

async function restoreGroupArtboardState(document: DocumentLike, visible: boolean): Promise<void> {
  const overlay = inspectGroupArtboardOverlay(document);
  if (!overlay.available || overlay.visible === visible) return;
  if (visible) await showGroupArtboards(document);
  else await hideGroupArtboards(document);
}

async function recaptureReferenceMode(document: DocumentLike, mode: ReferenceMode): Promise<void> {
  const collection = layerComps(document);
  if (!collection) return;
  const scan = scanReferences(document, true);
  const comp = findLayerComp(
    collection,
    mode === "reference" ? REFERENCE_COMP_NAME : RESTORE_COMP_NAME
  );
  if (!comp) return;
  comp.visibility = true;
  comp.position = false;
  comp.appearance = false;
  await comp.recapture();
  if (mode === "reference") comp.comment = referenceComment("reference", scan);
}

function scanReferences(document: DocumentLike, includeLegacy: boolean): ReferenceScan {
  const candidates = collectionValues(document.artboards ?? document.layers).filter((layer) =>
    Boolean(layer.layers?.length)
  );
  const artboards: LayerLike[] = [];
  const referenceLayers: LayerLike[] = [];
  const legacyReferenceLayers: LayerLike[] = [];

  for (const artboard of candidates) {
    const children = collectionValues(artboard.layers);
    const exact = children.filter((layer) => layer.name === REFERENCE_LAYER_NAME);
    if (exact.length) {
      artboards.push(artboard);
      referenceLayers.push(...exact);
      continue;
    }
    if (!includeLegacy) continue;

    const editableLayers = children.filter((layer) => EDITABLE_CANVAS_LAYER_NAME_PATTERN.test(layer.name));
    const legacyCandidates = children.filter((layer) => !EDITABLE_CANVAS_LAYER_NAME_PATTERN.test(layer.name));
    if (editableLayers.length === 1 && legacyCandidates.length === 1) {
      artboards.push(artboard);
      referenceLayers.push(legacyCandidates[0]!);
      legacyReferenceLayers.push(legacyCandidates[0]!);
    }
  }

  return { artboards, referenceLayers, legacyReferenceLayers };
}

function applyReferenceOnlyVisibility(document: DocumentLike, scan: ReferenceScan): void {
  const artboardIds = new Set(scan.artboards.map((layer) => layer.id));
  const referenceIds = new Set(scan.referenceLayers.map((layer) => layer.id));

  for (const topLayer of collectionValues(document.layers)) {
    if (!artboardIds.has(topLayer.id)) {
      topLayer.visible = false;
      continue;
    }
    topLayer.visible = true;
    for (const child of collectionValues(topLayer.layers)) {
      child.visible = referenceIds.has(child.id);
    }
  }
}

function layerComps(document: DocumentLike): LayerCompCollectionLike | null {
  const collection = document.layerComps;
  return collection && typeof collection.add === "function" ? collection : null;
}

async function captureLayerComp(
  collection: LayerCompCollectionLike,
  name: string,
  comment: string
): Promise<LayerCompLike> {
  let comp = findLayerComp(collection, name);
  if (comp) {
    comp.visibility = true;
    comp.position = false;
    comp.appearance = false;
    await comp.recapture();
  } else {
    comp = await collection.add({
      name,
      comment,
      visibility: true,
      position: false,
      appearance: false
    });
  }
  comp.comment = comment;
  return comp;
}

function findLayerComp(collection: LayerCompCollectionLike, name: string): LayerCompLike | undefined {
  for (let index = 0; index < collection.length; index += 1) {
    const comp = collection[index];
    if (comp?.name === name) return comp;
  }
  return undefined;
}

function referenceComment(mode: ReferenceMode, scan: ReferenceScan): string {
  return `${REFERENCE_COMMENT_PREFIX};mode=${mode};artboards=${scan.artboards.length};references=${scan.referenceLayers.length}`;
}

function parseReferenceComment(value: string | undefined): ReferenceComment | undefined {
  if (!value?.startsWith(REFERENCE_COMMENT_PREFIX)) return undefined;
  const mode = /(?:^|;)mode=(reference|normal)(?:;|$)/.exec(value)?.[1] as ReferenceMode | undefined;
  if (!mode) return undefined;
  const artboards = numericCommentValue(value, "artboards");
  const references = numericCommentValue(value, "references");
  return { mode, artboards, references };
}

function numericCommentValue(value: string, key: string): number | undefined {
  const match = new RegExp(`(?:^|;)${key}=(\\d+)(?:;|$)`).exec(value);
  return match ? Number(match[1]) : undefined;
}

function collectionValues(collection: LayerCollectionLike | undefined): LayerLike[] {
  if (!collection) return [];
  const values: LayerLike[] = [];
  for (let index = 0; index < collection.length; index += 1) {
    const layer = collection[index];
    if (layer) values.push(layer);
  }
  return values;
}
