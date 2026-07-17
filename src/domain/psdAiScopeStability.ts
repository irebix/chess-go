export interface PsdAiScopeNodeIdentity {
  assetCode: string;
  artboardId: number;
  referenceLayerId: number;
  targetLayerId?: number;
  targetIssue?: "missing" | "ambiguous";
}

export interface PsdAiScopeDocument {
  documentId: number;
  aiNodes: readonly PsdAiScopeNodeIdentity[];
}

export function psdAiScopeNodeKey(
  documentId: number,
  node: PsdAiScopeNodeIdentity
): string {
  return [
    "psd",
    documentId,
    node.assetCode,
    node.artboardId,
    node.referenceLayerId
  ].join(":");
}

export function accumulatePsdAiWatcherRefreshForce(
  pendingForce: boolean,
  requestedForce: boolean
): boolean {
  return pendingForce || requestedForce;
}

export interface PsdAiScopeGate<T extends PsdAiScopeDocument> {
  visible: T | null;
  lock: {
    documentId: number;
    baseline: T | null;
    pending: T | null;
  } | null;
}

export function createPsdAiScopeGate<T extends PsdAiScopeDocument>(
  visible: T | null
): PsdAiScopeGate<T> {
  return { visible, lock: null };
}

export function beginPsdAiScopeBackfill<T extends PsdAiScopeDocument>(
  gate: PsdAiScopeGate<T>,
  documentId: number
): PsdAiScopeGate<T> {
  return {
    ...gate,
    lock: {
      documentId,
      baseline: gate.visible?.documentId === documentId ? gate.visible : null,
      pending: gate.visible
    }
  };
}

export function applyPsdAiScopeScan<T extends PsdAiScopeDocument>(
  gate: PsdAiScopeGate<T>,
  next: T | null
): PsdAiScopeGate<T> {
  if (!gate.lock) return { visible: next, lock: null };
  const pendingLock = { ...gate.lock, pending: next };
  if (!next || next.documentId === gate.lock.documentId) {
    return { ...gate, lock: pendingLock };
  }
  return { visible: next, lock: pendingLock };
}

export function finishPsdAiScopeBackfill<T extends PsdAiScopeDocument>(
  gate: PsdAiScopeGate<T>,
  confirmed: T | null
): PsdAiScopeGate<T> {
  return { visible: confirmed, lock: null };
}

export function shouldConfirmPsdAiScopeShrink<T extends PsdAiScopeDocument>(
  gate: PsdAiScopeGate<T>,
  inspected: T | null
): boolean {
  const baseline = gate.lock?.baseline;
  if (!baseline) return false;
  if (!inspected) return true;
  if (baseline.documentId !== inspected.documentId) return false;
  const inspectedIds = new Set(
    inspected.aiNodes.map((node) => (
      psdAiScopeIdentity(node)
    ))
  );
  return baseline.aiNodes.some(
    (node) => !inspectedIds.has(psdAiScopeIdentity(node))
  );
}

function psdAiScopeIdentity(node: PsdAiScopeNodeIdentity): string {
  return [
    node.assetCode,
    node.artboardId,
    node.referenceLayerId,
    node.targetLayerId ?? node.targetIssue ?? "missing"
  ].join(":");
}
