import type {
  AiGeneratedImage,
  AiPendingSubmissionSnapshot
} from "../domain/aiCandidates";
import type { AiWorkflowVersion } from "../ai/aiWorkflowVersion";

export const HOLOPIX_PENDING_SUBMISSIONS_STORAGE_KEY = "chess-go:holopix-pending-submissions:v2";
export const HOLOPIX_DELETED_CANDIDATES_STORAGE_KEY = "chess-go:deleted-ai-candidates:v1";

export interface HolopixPendingSubmissionRecord extends AiPendingSubmissionSnapshot {
  version: 2;
  documentId: number;
  documentName: string;
  documentIdentity: string;
  assetCode: string;
  artboardId: number;
  referenceLayerId: number;
  targetLayerId?: number;
  targetIssue?: "missing" | "ambiguous";
  workflowVersion?: AiWorkflowVersion;
  createdAt: number;
}

export interface PendingSubmissionStorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface HolopixPendingSubmissionScope {
  documentIdentity: string;
  assetCode: string;
  artboardId: number;
  referenceLayerId: number;
  workflowVersion?: AiWorkflowVersion;
}

export interface HolopixPersistedCandidateRemoval {
  submissionKey?: string;
  image: AiGeneratedImage;
  scope: HolopixDeletedCandidateScope;
}

export interface HolopixDeletedCandidateScope {
  documentIdentity: string;
  assetCode: string;
  workflowVersion: AiWorkflowVersion;
}

export interface HolopixDeletedCandidateRecord extends HolopixDeletedCandidateScope {
  version: 1;
  imageKey: string;
  deletedAt: number;
}

export function holopixPendingSubmissionMatchesScope(
  pending: HolopixPendingSubmissionRecord,
  scope: HolopixPendingSubmissionScope
): boolean {
  return pending.documentIdentity === scope.documentIdentity
    && pending.assetCode === scope.assetCode
    && pending.artboardId === scope.artboardId
    && pending.referenceLayerId === scope.referenceLayerId
    && (scope.workflowVersion === undefined
      || effectiveWorkflowVersion(pending) === scope.workflowVersion);
}

export function promoteHolopixPendingSubmissionToOutput(
  pending: HolopixPendingSubmissionRecord,
  images: AiGeneratedImage[]
): HolopixPendingSubmissionRecord {
  const persistedImages = persistableHolopixImages(images).slice(0, pending.slotCount);
  const promptText = pending.promptText?.trim()
    || persistedImages.find((image) => image.promptText?.trim())?.promptText?.trim();
  return {
    ...pending,
    outcome: "output",
    images: persistedImages,
    ...(promptText ? { promptText } : {})
  };
}

export function persistableHolopixImages(images: AiGeneratedImage[]): AiGeneratedImage[] {
  return images.map((image) => ({
    filename: image.filename,
    subfolder: image.subfolder,
    type: image.type,
    url: image.url,
    ...(image.promptText ? { promptText: image.promptText } : {}),
    ...(image.previewError ? { previewError: image.previewError } : {})
  }));
}

export function loadHolopixPendingSubmissions(
  store: PendingSubmissionStorageLike = localStorage
): HolopixPendingSubmissionRecord[] {
  try {
    const raw = store.getItem(HOLOPIX_PENDING_SUBMISSIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isPendingSubmissionRecord) : [];
  } catch {
    return [];
  }
}

export function saveHolopixPendingSubmission(
  record: HolopixPendingSubmissionRecord,
  store: PendingSubmissionStorageLike = localStorage
): boolean {
  if (!isPendingSubmissionRecord(record)) return false;
  try {
    const current = loadHolopixPendingSubmissions(store).filter(
      (candidate) => candidate.submissionKey !== record.submissionKey
    );
    store.setItem(
      HOLOPIX_PENDING_SUBMISSIONS_STORAGE_KEY,
      JSON.stringify([...current, record])
    );
    return true;
  } catch {
    return false;
  }
}

export function removeHolopixPendingSubmissions(
  submissionKeys: Iterable<string>,
  store: PendingSubmissionStorageLike = localStorage
): boolean {
  const keys = new Set(submissionKeys);
  if (!keys.size) return true;
  try {
    const current = loadHolopixPendingSubmissions(store);
    store.setItem(
      HOLOPIX_PENDING_SUBMISSIONS_STORAGE_KEY,
      JSON.stringify(current.filter((record) => !keys.has(record.submissionKey)))
    );
    return true;
  } catch {
    return false;
  }
}

export function removeHolopixPersistedCandidateImages(
  removals: Iterable<HolopixPersistedCandidateRemoval>,
  store: PendingSubmissionStorageLike = localStorage
): boolean {
  const normalizedRemovals = Array.from(removals).filter((removal) => (
    Boolean(removal.scope.documentIdentity.trim())
    && Boolean(removal.scope.assetCode.trim())
  ));
  if (!normalizedRemovals.length) return true;
  const imageKeysBySubmission = new Map<string, Set<string>>();
  for (const removal of normalizedRemovals) {
    const submissionKey = removal.submissionKey?.trim();
    if (!submissionKey) continue;
    const imageKeys = imageKeysBySubmission.get(submissionKey) ?? new Set<string>();
    imageKeys.add(persistedImageKey(removal.image));
    imageKeysBySubmission.set(submissionKey, imageKeys);
  }
  try {
    const previousPendingRaw = store.getItem(HOLOPIX_PENDING_SUBMISSIONS_STORAGE_KEY);
    const nextPending = loadHolopixPendingSubmissions(store).flatMap((record) => {
      const imageKeys = imageKeysBySubmission.get(record.submissionKey);
      if (!imageKeys || !record.images?.length) return [record];
      const images = record.images.filter((image) => !imageKeys.has(persistedImageKey(image)));
      if (images.length === record.images.length) return [record];
      if (record.outcome === "output" && !images.length) return [];
      return [{ ...record, images }];
    });
    if (imageKeysBySubmission.size) {
      store.setItem(HOLOPIX_PENDING_SUBMISSIONS_STORAGE_KEY, JSON.stringify(nextPending));
    }
    const deletedByKey = new Map(
      loadHolopixDeletedCandidates(store).map((record) => [deletedCandidateRecordKey(record), record])
    );
    const deletedAt = Date.now();
    for (const removal of normalizedRemovals) {
      const record: HolopixDeletedCandidateRecord = {
        version: 1,
        ...removal.scope,
        imageKey: persistedImageKey(removal.image),
        deletedAt
      };
      deletedByKey.set(deletedCandidateRecordKey(record), record);
    }
    const deleted = Array.from(deletedByKey.values())
      .sort((left, right) => right.deletedAt - left.deletedAt)
      .slice(0, 2000);
    try {
      store.setItem(HOLOPIX_DELETED_CANDIDATES_STORAGE_KEY, JSON.stringify(deleted));
    } catch (error) {
      if (imageKeysBySubmission.size) {
        store.setItem(HOLOPIX_PENDING_SUBMISSIONS_STORAGE_KEY, previousPendingRaw ?? "[]");
      }
      throw error;
    }
    return true;
  } catch {
    return false;
  }
}

export function loadHolopixDeletedCandidates(
  store: PendingSubmissionStorageLike = localStorage
): HolopixDeletedCandidateRecord[] {
  try {
    const raw = store.getItem(HOLOPIX_DELETED_CANDIDATES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isDeletedCandidateRecord) : [];
  } catch {
    return [];
  }
}

export function filterHolopixDeletedCandidateImages(
  images: AiGeneratedImage[],
  scope: HolopixDeletedCandidateScope,
  store: PendingSubmissionStorageLike = localStorage
): AiGeneratedImage[] {
  const deletedImageKeys = new Set(loadHolopixDeletedCandidates(store).flatMap((record) => (
    deletedCandidateMatchesScope(record, scope) ? [record.imageKey] : []
  )));
  return images.filter((image) => !deletedImageKeys.has(persistedImageKey(image)));
}

function isPendingSubmissionRecord(value: unknown): value is HolopixPendingSubmissionRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<HolopixPendingSubmissionRecord>;
  return record.version === 2
    && typeof record.documentName === "string"
    && Boolean(record.documentName.trim())
    && isFiniteInteger(record.documentId)
    && typeof record.documentIdentity === "string"
    && Boolean(record.documentIdentity.trim())
    && typeof record.assetCode === "string"
    && Boolean(record.assetCode.trim())
    && isFiniteInteger(record.artboardId)
    && isFiniteInteger(record.referenceLayerId)
    && (record.targetLayerId === undefined || isFiniteInteger(record.targetLayerId))
    && (record.targetIssue === undefined || record.targetIssue === "missing" || record.targetIssue === "ambiguous")
    && (record.workflowVersion === undefined || record.workflowVersion === "flux" || record.workflowVersion === "gpt-image-2")
    && isFiniteInteger(record.slotCount)
    && record.slotCount! >= 1
    && record.slotCount! <= 4
    && typeof record.submissionKey === "string"
    && Boolean(record.submissionKey.trim())
    && (record.promptId === undefined || typeof record.promptId === "string")
    && (record.promptText === undefined || typeof record.promptText === "string")
    && (record.outcome === undefined || record.outcome === "pending" || record.outcome === "output")
    && (record.images === undefined || (
      Array.isArray(record.images) && record.images.every(isPersistedGeneratedImage)
    ))
    && (record.outcome !== "output" || Boolean(record.images?.length))
    && typeof record.createdAt === "number"
    && Number.isFinite(record.createdAt);
}

function isPersistedGeneratedImage(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const image = value as Record<string, unknown>;
  return typeof image.filename === "string"
    && Boolean(image.filename)
    && typeof image.subfolder === "string"
    && typeof image.type === "string"
    && Boolean(image.type)
    && typeof image.url === "string"
    && Boolean(image.url)
    && (image.promptText === undefined || typeof image.promptText === "string")
    && (image.previewError === undefined || typeof image.previewError === "string");
}

function isDeletedCandidateRecord(value: unknown): value is HolopixDeletedCandidateRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Partial<HolopixDeletedCandidateRecord>;
  return record.version === 1
    && typeof record.documentIdentity === "string"
    && Boolean(record.documentIdentity.trim())
    && typeof record.assetCode === "string"
    && Boolean(record.assetCode.trim())
    && (record.workflowVersion === "flux" || record.workflowVersion === "gpt-image-2")
    && typeof record.imageKey === "string"
    && Boolean(record.imageKey)
    && typeof record.deletedAt === "number"
    && Number.isFinite(record.deletedAt);
}

function deletedCandidateMatchesScope(
  record: HolopixDeletedCandidateRecord,
  scope: HolopixDeletedCandidateScope
): boolean {
  return record.documentIdentity === scope.documentIdentity
    && record.assetCode === scope.assetCode
    && record.workflowVersion === scope.workflowVersion;
}

function deletedCandidateRecordKey(record: HolopixDeletedCandidateRecord): string {
  return [
    record.documentIdentity,
    record.assetCode,
    record.workflowVersion,
    record.imageKey
  ].join("|");
}

function persistedImageKey(image: Pick<AiGeneratedImage, "filename" | "subfolder" | "type">): string {
  return `${image.type}:${image.subfolder}:${image.filename}`;
}

function isFiniteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value);
}

export function effectivePendingWorkflowVersion(
  record: Pick<HolopixPendingSubmissionRecord, "workflowVersion">
): AiWorkflowVersion {
  return effectiveWorkflowVersion(record);
}

function effectiveWorkflowVersion(
  record: Pick<HolopixPendingSubmissionRecord, "workflowVersion">
): AiWorkflowVersion {
  return record.workflowVersion === "gpt-image-2" ? "gpt-image-2" : "flux";
}
