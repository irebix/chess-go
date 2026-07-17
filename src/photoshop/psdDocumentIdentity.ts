export interface PsdDocumentIdentitySource {
  id: number;
  path?: string;
  cloudDocument?: boolean;
}

const PSD_PLUGIN_SESSION_ID = [
  Date.now().toString(36),
  Math.random().toString(36).slice(2)
].join("-");

/**
 * Returns a stable identity for saved documents and a deliberately session-local
 * identity for unsaved documents. An unsaved document must never match a pending
 * paid submission after the plugin/Photoshop session has restarted.
 */
export function psdDocumentIdentity(
  source: PsdDocumentIdentitySource,
  sessionId = PSD_PLUGIN_SESSION_ID
): string {
  const path = readDocumentPath(source);
  if (path) {
    const cloudDocument = readCloudDocumentFlag(source);
    const normalized = normalizePsdDocumentPath(path, cloudDocument);
    if (normalized) return `${cloudDocument ? "cloud" : "file"}:${normalized}`;
  }
  return `session:${sessionId}:document:${source.id}`;
}

export function normalizePsdDocumentPath(
  value: string,
  cloudDocument = false
): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (!cloudDocument && !isAbsoluteLocalPath(trimmed)) return undefined;
  const normalized = trimmed
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/\/$/, "");
  return cloudDocument ? normalized : normalized.toLowerCase();
}

export function isStablePsdDocumentIdentity(identity: string): boolean {
  return identity.startsWith("file:") || identity.startsWith("cloud:");
}

function readDocumentPath(source: PsdDocumentIdentitySource): string | undefined {
  try {
    return typeof source.path === "string" ? source.path : undefined;
  } catch {
    return undefined;
  }
}

function readCloudDocumentFlag(source: PsdDocumentIdentitySource): boolean {
  try {
    return source.cloudDocument === true;
  } catch {
    return false;
  }
}

function isAbsoluteLocalPath(value: string): boolean {
  return /^(?:[A-Za-z]:[\\/]|[\\/]{1,2}|file:)/i.test(value);
}
