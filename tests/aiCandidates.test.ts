import { describe, expect, it } from "vitest";
import {
  acceptAiCandidate,
  aiCandidateSlotLabel,
  aiCandidateAction,
  appendAiCandidateSlots,
  isAiCandidateActionDisabled,
  reconcileAiItemStates,
  selectedAiReferenceImage,
  summarizeAiCandidates
} from "../src/domain/aiCandidates";
import type { AssetCandidate } from "../src/domain/models";

const item = {
  key: "sheet:103001",
  assetCode: "103001",
  name: "抹布"
} as AssetCandidate;

describe("AI candidate state", () => {
  it("creates 1–4 stable labeled slots and preserves existing output", () => {
    const initial = reconcileAiItemStates({}, [item], 2);
    const first = initial[item.key]!;
    first.candidates[0] = {
      ...first.candidates[0]!,
      status: "ready",
      image: { filename: "a.png", subfolder: "", type: "output", url: "http://local/a.png" }
    };
    const resized = reconcileAiItemStates(initial, [item], 4);
    expect(resized[item.key]!.candidates.map((slot) => slot.label)).toEqual(["A", "B", "C", "D"]);
    expect(resized[item.key]!.candidates[0]!.image?.filename).toBe("a.png");
  });

  it("accepts one output and returns a previous acceptance to ready", () => {
    const state = reconcileAiItemStates({}, [item], 2)[item.key]!;
    state.candidates = state.candidates.map((slot) => ({
      ...slot,
      status: "ready",
      image: { filename: `${slot.label}.png`, subfolder: "", type: "output", url: slot.label }
    }));
    const first = acceptAiCandidate(state, state.candidates[0]!.id);
    const second = acceptAiCandidate(first, first.candidates[1]!.id);
    expect(second.candidates.map((slot) => slot.status)).toEqual(["ready", "accepted"]);
    expect(summarizeAiCandidates([second])).toMatchObject({ total: 2, completed: 2, accepted: 1 });
  });

  it("uses only the Excel image explicitly selected for the generated PSD", () => {
    const reference = {
      id: "image-1",
      anchor: {
        fromRow: 1,
        fromCol: 1,
        relationshipId: "rId1",
        archiveEntry: "xl/media/image1.png",
        mediaType: "png" as const
      },
      relativeRowOffset: 0,
      relativeColOffset: 0,
      thumbnailState: "notLoaded" as const
    };
    const withoutSelection = { ...item, imageCandidates: [reference] } as AssetCandidate;
    const withSelection = { ...withoutSelection, selectedImageId: reference.id };

    expect(selectedAiReferenceImage(withoutSelection)).toBeUndefined();
    expect(selectedAiReferenceImage(withSelection)).toBe(reference);
  });

  it("keeps completed candidates available for backfill while generation continues", () => {
    const state = reconcileAiItemStates({}, [item], 2)[item.key]!;
    const ready = {
      ...state.candidates[0]!,
      status: "ready" as const,
      image: { filename: "ready.png", subfolder: "", type: "output", url: "ready" }
    };
    const idle = state.candidates[1]!;

    expect(aiCandidateAction(ready)).toBe("backfill");
    expect(isAiCandidateActionDisabled(ready, true, false)).toBe(false);
    expect(aiCandidateAction(idle)).toBe("generate");
    expect(isAiCandidateActionDisabled(idle, true, false)).toBe(true);
  });

  it("appends queued candidates without replacing existing output", () => {
    const state = reconcileAiItemStates({}, [item], 1)[item.key]!;
    state.candidates[0] = {
      ...state.candidates[0]!,
      status: "ready",
      image: { filename: "old.png", subfolder: "", type: "output", url: "old" }
    };

    const appended = appendAiCandidateSlots(state, 2);

    expect(appended.candidates.map((candidate) => candidate.status)).toEqual([
      "ready",
      "queued",
      "queued"
    ]);
    expect(appended.candidates[0]!.image?.filename).toBe("old.png");
    expect(appended.candidates.map((candidate) => candidate.label)).toEqual(["A", "B", "C"]);
    expect(reconcileAiItemStates({ [item.key]: appended }, [item], 1)[item.key]!.candidates).toHaveLength(3);
  });

  it("can reduce unused initial slots while preserving every generated or queued slot", () => {
    const unused = reconcileAiItemStates({}, [item], 4);
    expect(reconcileAiItemStates(unused, [item], 1)[item.key]!.candidates).toHaveLength(1);

    const used = appendAiCandidateSlots(reconcileAiItemStates({}, [item], 1)[item.key]!, 2);
    expect(reconcileAiItemStates({ [item.key]: used }, [item], 1)[item.key]!.candidates).toHaveLength(3);
  });

  it("keeps stable labels after the first four candidate slots", () => {
    expect(aiCandidateSlotLabel(0)).toBe("A");
    expect(aiCandidateSlotLabel(25)).toBe("Z");
    expect(aiCandidateSlotLabel(26)).toBe("AA");
  });
});
