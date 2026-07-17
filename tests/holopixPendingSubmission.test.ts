import { describe, expect, it } from "vitest";
import {
  HOLOPIX_PENDING_SUBMISSIONS_STORAGE_KEY,
  holopixPendingSubmissionMatchesScope,
  loadHolopixPendingSubmissions,
  promoteHolopixPendingSubmissionToOutput,
  removeHolopixPendingSubmissions,
  saveHolopixPendingSubmission,
  type HolopixPendingSubmissionRecord,
  type PendingSubmissionStorageLike
} from "../src/services/HolopixPendingSubmissionService";
import {
  buildAiCandidateGenerationBatches,
  mergeRecoveredAiCandidateImages,
  reconcileAiItemStates,
  restoreAiPendingSubmission
} from "../src/domain/aiCandidates";
import type { AssetCandidate } from "../src/domain/models";

class MemoryStorage implements PendingSubmissionStorageLike {
  private readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const record = (overrides: Partial<HolopixPendingSubmissionRecord> = {}): HolopixPendingSubmissionRecord => ({
  version: 2,
  documentId: 42,
  documentName: "cleaning.psd",
  documentIdentity: "file:d:/work/cleaning.psd",
  assetCode: "c_cleaning1",
  artboardId: 1,
  referenceLayerId: 12,
  targetLayerId: 11,
  slotCount: 2,
  submissionKey: "c_cleaning1:123:0",
  createdAt: 123,
  ...overrides
});

describe("Holopix pending submission persistence", () => {
  it("persists a provisional submission and updates it with prompt_id", () => {
    const store = new MemoryStorage();
    expect(saveHolopixPendingSubmission(record(), store)).toBe(true);
    expect(saveHolopixPendingSubmission(record({ promptId: "prompt-42" }), store)).toBe(true);
    expect(loadHolopixPendingSubmissions(store)).toEqual([
      expect.objectContaining({ submissionKey: "c_cleaning1:123:0", promptId: "prompt-42" })
    ]);
  });

  it("removes a submission when its safety record is no longer needed", () => {
    const store = new MemoryStorage();
    saveHolopixPendingSubmission(record(), store);
    saveHolopixPendingSubmission(record({ submissionKey: "second" }), store);
    expect(removeHolopixPendingSubmissions(["c_cleaning1:123:0"], store)).toBe(true);
    expect(loadHolopixPendingSubmissions(store).map((entry) => entry.submissionKey)).toEqual(["second"]);
  });

  it("ignores malformed stored records", () => {
    const store = new MemoryStorage();
    store.setItem(HOLOPIX_PENDING_SUBMISSIONS_STORAGE_KEY, JSON.stringify([
      record(),
      { version: 2, submissionKey: "broken" }
    ]));
    expect(loadHolopixPendingSubmissions(store)).toHaveLength(1);
  });

  it("persists definite output metadata without serializing preview pixels", () => {
    const store = new MemoryStorage();
    expect(saveHolopixPendingSubmission(record({
      outcome: "output",
      promptId: "prompt-42",
      images: [{
        filename: "a.png",
        subfolder: "Holopix/ChessGo/c_cleaning1",
        type: "output",
        url: "http://127.0.0.1:8188/view?a.png"
      }]
    }), store)).toBe(true);
    expect(loadHolopixPendingSubmissions(store)[0]).toMatchObject({
      outcome: "output",
      images: [{ filename: "a.png" }]
    });
  });

  it("matches the same stable PSD identity and reference even after target repair", () => {
    const scope = {
      documentIdentity: "file:d:/work/cleaning.psd",
      assetCode: "c_cleaning1",
      artboardId: 1,
      referenceLayerId: 12,
      targetLayerId: 11
    };
    expect(holopixPendingSubmissionMatchesScope(record(), scope)).toBe(true);
    expect(holopixPendingSubmissionMatchesScope(record({ targetLayerId: 99 }), scope)).toBe(true);
    expect(holopixPendingSubmissionMatchesScope(record({
      documentId: 42,
      documentName: "cleaning.psd",
      documentIdentity: "file:d:/cloned/cleaning.psd"
    }), scope)).toBe(false);
    expect(holopixPendingSubmissionMatchesScope(record({ referenceLayerId: 13 }), scope)).toBe(false);
  });

  it("persists a submission made while the editable target is missing", () => {
    const store = new MemoryStorage();
    expect(saveHolopixPendingSubmission(record({
      targetLayerId: undefined,
      targetIssue: "missing"
    }), store)).toBe(true);
    expect(loadHolopixPendingSubmissions(store)[0]).toMatchObject({ targetIssue: "missing" });
  });

  it("promotes exact recovery to durable output before a simulated reload", () => {
    const store = new MemoryStorage();
    const pending = record({ promptId: "prompt-42", outcome: "pending" });
    saveHolopixPendingSubmission(pending, store);
    const item = {
      key: "psd:42:c_cleaning1",
      assetCode: "c_cleaning1",
      name: "清洁布"
    } as AssetCandidate;
    let state = restoreAiPendingSubmission(
      reconcileAiItemStates({}, [item], 2)[item.key]!,
      pending
    );
    const recoveredImages = [
      { filename: "a.png", subfolder: "", type: "output", url: "a", promptText: "paid prompt" },
      { filename: "b.png", subfolder: "", type: "output", url: "b", promptText: "paid prompt" }
    ];
    state = mergeRecoveredAiCandidateImages(
      state,
      recoveredImages,
      { promptId: "prompt-42" }
    ).item;
    expect(state.candidates.every((candidate) => candidate.status === "ready")).toBe(true);
    expect(state.candidates.every((candidate) => candidate.submissionKey === pending.submissionKey)).toBe(true);

    saveHolopixPendingSubmission(
      promoteHolopixPendingSubmissionToOutput(pending, recoveredImages),
      store
    );
    const reloaded = restoreAiPendingSubmission(
      reconcileAiItemStates({}, [item], 2)[item.key]!,
      loadHolopixPendingSubmissions(store)[0]!
    );

    expect(reloaded.candidates.map((candidate) => candidate.status)).toEqual(["ready", "ready"]);
    expect(buildAiCandidateGenerationBatches(reloaded.candidates)).toEqual([]);
  });
});
