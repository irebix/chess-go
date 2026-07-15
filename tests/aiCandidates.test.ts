import { describe, expect, it } from "vitest";
import {
  acceptAiCandidate,
  reconcileAiItemStates,
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
});
