import { describe, expect, it } from "vitest";
import {
  accumulatePsdAiWatcherRefreshForce,
  applyPsdAiScopeScan,
  beginPsdAiScopeBackfill,
  createPsdAiScopeGate,
  finishPsdAiScopeBackfill,
  psdAiScopeNodeKey,
  shouldConfirmPsdAiScopeShrink
} from "../src/domain/psdAiScopeStability";

function documentState(documentId: number, nodeIds: number[]) {
  return {
    documentId,
    aiNodes: nodeIds.map((artboardId) => ({
      assetCode: `asset-${artboardId}`,
      artboardId,
      referenceLayerId: artboardId + 100,
      targetLayerId: artboardId + 200
    }))
  };
}

describe("PSD AI scope stability", () => {
  it("does not let a trailing select downgrade a pending structural refresh", () => {
    const afterMove = accumulatePsdAiWatcherRefreshForce(false, true);
    expect(accumulatePsdAiWatcherRefreshForce(afterMove, false)).toBe(true);
  });

  it("keeps candidate state across target repair but not asset/reference replacement", () => {
    const node = {
      assetCode: "c_cleaning1",
      artboardId: 1,
      referenceLayerId: 12,
      targetLayerId: 11
    };
    expect(psdAiScopeNodeKey(42, node)).toBe("psd:42:c_cleaning1:1:12");
    expect(psdAiScopeNodeKey(42, { ...node, assetCode: "c_cleaning_renamed" }))
      .not.toBe(psdAiScopeNodeKey(42, node));
    expect(psdAiScopeNodeKey(42, { ...node, targetLayerId: 99 }))
      .toBe(psdAiScopeNodeKey(42, node));
    expect(psdAiScopeNodeKey(42, { ...node, targetLayerId: undefined }))
      .toBe(psdAiScopeNodeKey(42, node));
    expect(psdAiScopeNodeKey(42, { ...node, referenceLayerId: 98 }))
      .not.toBe(psdAiScopeNodeKey(42, node));
  });

  it("holds a transient same-document 4 to 3 scan while backfill is locked", () => {
    const baseline = documentState(42, [1, 2, 3, 4]);
    const locked = beginPsdAiScopeBackfill(createPsdAiScopeGate(baseline), 42);
    const scanned = applyPsdAiScopeScan(locked, documentState(42, [2, 3, 4]));

    expect(scanned.visible!.aiNodes).toHaveLength(4);
    expect(scanned.lock?.pending?.aiNodes).toHaveLength(3);
    expect(shouldConfirmPsdAiScopeShrink(scanned, scanned.lock!.pending)).toBe(true);
  });

  it("treats an assetCode rename as a different paid-generation scope", () => {
    const baseline = documentState(42, [1]);
    const locked = beginPsdAiScopeBackfill(createPsdAiScopeGate(baseline), 42);
    const renamed = {
      ...baseline,
      aiNodes: [{ ...baseline.aiNodes[0]!, assetCode: "renamed" }]
    };
    expect(shouldConfirmPsdAiScopeShrink(locked, renamed)).toBe(true);
  });

  it("commits a complete post-modal rescan", () => {
    const baseline = documentState(42, [1, 2, 3, 4]);
    const locked = beginPsdAiScopeBackfill(createPsdAiScopeGate(baseline), 42);
    const finished = finishPsdAiScopeBackfill(locked, documentState(42, [1, 2, 3, 4]));

    expect(finished.lock).toBeNull();
    expect(finished.visible!.aiNodes).toHaveLength(4);
  });

  it("accepts a confirmed real deletion after the second scan", () => {
    const baseline = documentState(42, [1, 2, 3, 4]);
    const locked = beginPsdAiScopeBackfill(createPsdAiScopeGate(baseline), 42);
    const first = documentState(42, [2, 3, 4]);

    expect(shouldConfirmPsdAiScopeShrink(locked, first)).toBe(true);
    expect(finishPsdAiScopeBackfill(locked, documentState(42, [2, 3, 4])).visible!.aiNodes)
      .toHaveLength(3);
  });

  it("switches to a different document immediately while the old document is locked", () => {
    const locked = beginPsdAiScopeBackfill(
      createPsdAiScopeGate(documentState(42, [1, 2, 3, 4])),
      42
    );
    const scanned = applyPsdAiScopeScan(locked, documentState(84, [9]));

    expect(scanned.visible!.documentId).toBe(84);
  });

  it("clears the scope when the post-modal inspection confirms no document", () => {
    const locked = beginPsdAiScopeBackfill(createPsdAiScopeGate(documentState(42, [1])), 42);
    expect(shouldConfirmPsdAiScopeShrink(locked, null)).toBe(true);
    expect(finishPsdAiScopeBackfill(locked, null).visible).toBeNull();
  });

  it("applies ordinary scans immediately when no backfill is locked", () => {
    const gate = createPsdAiScopeGate(documentState(42, [1, 2]));
    expect(applyPsdAiScopeScan(gate, documentState(42, [2])).visible!.aiNodes).toHaveLength(1);
  });
});
