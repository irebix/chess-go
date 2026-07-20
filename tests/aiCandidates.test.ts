import { describe, expect, it } from "vitest";
import {
  abandonAiCandidateUnknowns,
  acceptAiCandidate,
  aiCandidateSlotLabel,
  aiCandidateAction,
  applyAiGeneratedCandidateBatch,
  appendAiCandidateSlots,
  buildAiCandidateGenerationBatches,
  failAiCandidateGenerationRemainder,
  isAiCandidateDeletable,
  isAiCandidateActionDisabled,
  markAiCandidateGenerationUnknown,
  mergeRecoveredAiCandidateImages,
  reconcileAiItemStates,
  removeAiCandidateImages,
  restoreAiPendingSubmission,
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

  it("removes selected generated images, preserves base slots and trims deleted history slots", () => {
    let state = appendAiCandidateSlots(
      reconcileAiItemStates({}, [item], 2)[item.key]!,
      2
    );
    state = {
      ...state,
      candidates: state.candidates.map((candidate, index) => ({
        ...candidate,
        status: index === 1 ? "accepted" as const : "ready" as const,
        image: {
          filename: `${candidate.label}.png`,
          subfolder: "Holopix/ChessGo/103001",
          type: "output",
          url: candidate.label,
          promptText: `prompt ${candidate.label}`
        },
        submissionKey: index < 2 ? "batch-1" : `batch-${index}`
      }))
    };

    expect(state.candidates.every(isAiCandidateDeletable)).toBe(true);
    const removed = removeAiCandidateImages(
      state,
      [state.candidates[1]!.id, state.candidates[3]!.id],
      2
    );

    expect(removed.removed.map((candidate) => candidate.image.filename)).toEqual(["B.png", "D.png"]);
    expect(removed.item.candidates).toHaveLength(3);
    expect(removed.item.candidates.map((candidate) => candidate.status)).toEqual(["ready", "idle", "ready"]);
    expect(removed.item.candidates[1]).toMatchObject({ retryPromptText: "prompt B" });
    expect(isAiCandidateDeletable(removed.item.candidates[1]!)).toBe(false);

    const cleared = removeAiCandidateImages(
      removed.item,
      removed.item.candidates.filter(isAiCandidateDeletable).map((candidate) => candidate.id),
      2
    );
    expect(cleared.item.candidates).toHaveLength(2);
    expect(cleared.item.candidates.map((candidate) => candidate.status)).toEqual(["idle", "idle"]);
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

  it("keeps a user-edited prompt on appended slots and separates it from QwenVL retries", () => {
    const state = reconcileAiItemStates({}, [item], 2)[item.key]!;
    state.candidates[0] = { ...state.candidates[0]!, status: "failed" };
    const appended = appendAiCandidateSlots(state, 2, "  custom prompt  ");
    appended.candidates[2] = { ...appended.candidates[2]!, status: "failed" };
    appended.candidates[3] = { ...appended.candidates[3]!, status: "failed" };

    expect(appended.candidates[2]!.retryPromptText).toBe("custom prompt");
    expect(buildAiCandidateGenerationBatches(appended.candidates)).toEqual([
      { slotIndexes: [0, 1] },
      { slotIndexes: [2, 3], promptText: "custom prompt" }
    ]);
  });

  it("chunks retries sharing the same generation source without mixing prompts", () => {
    const state = reconcileAiItemStates({}, [item], 1)[item.key]!;
    const appended = appendAiCandidateSlots(state, 4, "custom");
    const candidates = appended.candidates.map((candidate) => ({ ...candidate, status: "failed" as const }));

    expect(buildAiCandidateGenerationBatches(candidates, 2)).toEqual([
      { slotIndexes: [0] },
      { slotIndexes: [1, 2], promptText: "custom" },
      { slotIndexes: [3, 4], promptText: "custom" }
    ]);
  });

  it("keeps a completed 2-image batch and retries only the failed third slot with its QwenVL prompt", () => {
    let state = reconcileAiItemStates({}, [item], 3)[item.key]!;
    state = {
      ...state,
      candidates: state.candidates.map((candidate) => ({ ...candidate, status: "generating" }))
    };
    const promptText = "resolved QwenVL prompt";
    state = applyAiGeneratedCandidateBatch(
      state,
      [0, 1, 2],
      0,
      [
        { filename: "a.png", subfolder: "", type: "output", url: "a", promptText },
        { filename: "b.png", subfolder: "", type: "output", url: "b", promptText }
      ],
      promptText
    );
    state = failAiCandidateGenerationRemainder(state, [0, 1, 2], 2, "second batch failed", promptText);

    expect(state.candidates.map((candidate) => candidate.status)).toEqual(["ready", "ready", "failed"]);
    expect(state.candidates[2]!.retryPromptText).toBe(promptText);
    expect(buildAiCandidateGenerationBatches(state.candidates)).toEqual([
      { slotIndexes: [2], promptText }
    ]);
  });

  it("preserves an edited prompt when generation fails before any batch completes", () => {
    const state = appendAiCandidateSlots(
      reconcileAiItemStates({}, [item], 1)[item.key]!,
      2,
      "edited prompt"
    );
    const failed = failAiCandidateGenerationRemainder(
      state,
      [1, 2],
      0,
      "queue failed",
      "edited prompt"
    );

    expect(failed.candidates.slice(1).map((candidate) => candidate.retryPromptText))
      .toEqual(["edited prompt", "edited prompt"]);
  });

  it("does not offer a paid submission with an unknown outcome for immediate retry", () => {
    const state = reconcileAiItemStates({}, [item], 2)[item.key]!;
    const unknown = markAiCandidateGenerationUnknown(
      state,
      [0, 1],
      0,
      "history timeout",
      { promptId: "prompt-42", key: "request-42" },
      "captured prompt"
    );

    expect(unknown.candidates.map((candidate) => candidate.status)).toEqual(["unknown", "unknown"]);
    expect(unknown.candidates[0]).toMatchObject({
      submissionPromptId: "prompt-42",
      submissionKey: "request-42",
      retryPromptText: "captured prompt"
    });
    expect(aiCandidateAction(unknown.candidates[0]!)).toBeNull();
    expect(buildAiCandidateGenerationBatches(unknown.candidates)).toEqual([]);
    expect(summarizeAiCandidates([unknown]).unknown).toBe(2);
  });

  it("restores a persisted paid submission as unknown and requires explicit abandonment", () => {
    const state = reconcileAiItemStates({}, [item], 1)[item.key]!;
    const restored = restoreAiPendingSubmission(state, {
      slotCount: 2,
      submissionKey: "request-42",
      promptId: "prompt-42",
      promptText: "paid prompt"
    });

    expect(restored.candidates.map((candidate) => candidate.status)).toEqual(["unknown", "unknown"]);
    expect(buildAiCandidateGenerationBatches(restored.candidates)).toEqual([]);
    expect(restoreAiPendingSubmission(restored, {
      slotCount: 2,
      submissionKey: "request-42",
      promptId: "prompt-42"
    }).candidates).toHaveLength(2);

    const abandoned = abandonAiCandidateUnknowns(restored);
    expect(abandoned.abandonedCount).toBe(2);
    expect(abandoned.submissionKeys).toEqual(["request-42"]);
    expect(abandoned.item.candidates.map((candidate) => candidate.status)).toEqual(["failed", "failed"]);
    expect(buildAiCandidateGenerationBatches(abandoned.item.candidates)).toEqual([
      { slotIndexes: [0, 1], promptText: "paid prompt" }
    ]);
  });

  it("restores persisted paid output as ready and does not duplicate it", () => {
    const state = reconcileAiItemStates({}, [item], 1)[item.key]!;
    const persisted = {
      slotCount: 2,
      submissionKey: "request-output",
      promptId: "prompt-output",
      promptText: "paid prompt",
      outcome: "output" as const,
      images: [
        { filename: "a.png", subfolder: "", type: "output", url: "a" },
        { filename: "b.png", subfolder: "", type: "output", url: "b" }
      ]
    };

    const restored = restoreAiPendingSubmission(state, persisted);
    expect(restored.candidates.map((candidate) => candidate.status)).toEqual(["ready", "ready"]);
    expect(restored.candidates.map((candidate) => candidate.image?.filename)).toEqual(["a.png", "b.png"]);
    expect(restored.candidates[0]).toMatchObject({
      submissionKey: "request-output",
      submissionPromptId: "prompt-output"
    });
    expect(restoreAiPendingSubmission(restored, persisted).candidates).toHaveLength(2);
  });

  it("keeps an accepted candidate accepted when its safe preview arrives later", () => {
    const state = reconcileAiItemStates({}, [item], 1)[item.key]!;
    state.candidates[0] = {
      ...state.candidates[0]!,
      status: "accepted",
      image: { filename: "raw.png", subfolder: "", type: "output", url: "raw" }
    };
    const enhanced = applyAiGeneratedCandidateBatch(
      state,
      [0],
      0,
      [{
        filename: "raw.png",
        subfolder: "",
        type: "output",
        url: "raw",
        preview: { width: 1, height: 1, pixels: new Uint8ClampedArray([0, 0, 0, 255]) }
      }]
    );

    expect(enhanced.candidates[0]!.status).toBe("accepted");
    expect(enhanced.candidates[0]!.image?.preview?.width).toBe(1);
  });

  it("recovers only the missing paid image into an unknown remainder slot", () => {
    let state = reconcileAiItemStates({}, [item], 3)[item.key]!;
    const first = { filename: "a.png", subfolder: "", type: "output", url: "a" };
    const second = { filename: "b.png", subfolder: "", type: "output", url: "b" };
    const third = { filename: "c.png", subfolder: "", type: "output", url: "c" };
    state.candidates[0] = { ...state.candidates[0]!, status: "ready", image: first };
    state.candidates[1] = { ...state.candidates[1]!, status: "ready", image: second };
    state = markAiCandidateGenerationUnknown(
      state,
      [0, 1, 2],
      2,
      "history timeout",
      { promptId: "prompt-3" },
      "same prompt"
    );

    const broadRecovery = mergeRecoveredAiCandidateImages(state, [first, second, third]);
    expect(broadRecovery.recoveredCount).toBe(0);
    expect(broadRecovery.item.candidates[2]!.status).toBe("unknown");

    const recovered = mergeRecoveredAiCandidateImages(
      state,
      [first, second, third],
      { promptId: "prompt-3" }
    );

    expect(recovered.recoveredCount).toBe(1);
    expect(recovered.item.candidates.map((candidate) => candidate.image?.filename))
      .toEqual(["a.png", "b.png", "c.png"]);
    expect(recovered.item.candidates[2]!.status).toBe("ready");
    expect(recovered.item.candidates[2]!.submissionPromptId).toBe("prompt-3");
  });

  it("upgrades a persisted raw output with its recovered safe preview", () => {
    let state = reconcileAiItemStates({}, [item], 1)[item.key]!;
    state = restoreAiPendingSubmission(state, {
      slotCount: 1,
      submissionKey: "request-output",
      promptId: "prompt-output",
      outcome: "output",
      images: [{ filename: "a.png", subfolder: "", type: "output", url: "raw" }]
    });
    const recovered = mergeRecoveredAiCandidateImages(state, [{
      filename: "a.png",
      subfolder: "",
      type: "output",
      url: "raw",
      preview: { width: 1, height: 1, pixels: new Uint8ClampedArray([0, 0, 0, 255]) }
    }]);

    expect(recovered.recoveredCount).toBe(1);
    expect(recovered.item.candidates).toHaveLength(1);
    expect(recovered.item.candidates[0]!.image?.preview?.width).toBe(1);
    expect(recovered.item.candidates[0]!.submissionKey).toBe("request-output");
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
