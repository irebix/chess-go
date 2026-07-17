import type {
  AiGeneratedImage,
  AiPendingSubmissionSnapshot
} from "../domain/aiCandidates";

export const HOLOPIX_PENDING_SUBMISSIONS_STORAGE_KEY = "chess-go:holopix-pending-submissions:v2";

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
}

export function holopixPendingSubmissionMatchesScope(
  pending: HolopixPendingSubmissionRecord,
  scope: HolopixPendingSubmissionScope
): boolean {
  return pending.documentIdentity === scope.documentIdentity
    && pending.assetCode === scope.assetCode
    && pending.artboardId === scope.artboardId
    && pending.referenceLayerId === scope.referenceLayerId;
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

function isFiniteInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && Number.isFinite(value);
}
