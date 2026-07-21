import { describe, expect, it } from "vitest";
import { buildGptImage2GenerationRounds } from "../src/domain/gptImage2Generation";
import {
  appendAiCandidateSlots,
  applyAiPromptDraftToGeneratableCandidates,
  type AiItemState
} from "../src/domain/aiCandidates";

const items = [
  { key: "one", assetCode: "a1" },
  { key: "two", assetCode: "a2" }
];

describe("GPT Image 2 generation rounds", () => {
  it("turns candidate columns into whole-chain executions", () => {
    const rounds = buildGptImage2GenerationRounds(items, {
      one: state("one", ["idle", "idle"]),
      two: state("two", ["idle", "idle"])
    });
    expect(rounds.map((round) => ({
      slotIndex: round.slotIndex,
      assetCodes: round.entries.map((entry) => entry.item.assetCode)
    }))).toEqual([
      { slotIndex: 0, assetCodes: ["a1", "a2"] },
      { slotIndex: 1, assetCodes: ["a1", "a2"] }
    ]);
  });

  it("reduces a single failed cell to a one-item whole-chain retry", () => {
    const one = state("one", ["ready", "failed"]);
    one.candidates[1]!.retryPromptText = "custom one";
    const rounds = buildGptImage2GenerationRounds(items, {
      one,
      two: state("two", ["ready", "ready"])
    });
    expect(rounds).toHaveLength(1);
    expect(rounds[0]).toMatchObject({
      slotIndex: 1,
      entries: [{ item: items[0], promptText: "custom one" }]
    });
  });

  it("turns an appended four-group batch into four new whole-chain rounds", () => {
    const completed = {
      one: state("one", ["ready", "ready"]),
      two: state("two", ["ready", "ready"])
    };
    const appended = {
      one: appendAiCandidateSlots(completed.one, 4, undefined, "idle"),
      two: appendAiCandidateSlots(completed.two, 4, undefined, "idle")
    };

    const rounds = buildGptImage2GenerationRounds(items, appended);
    expect(rounds.map((round) => ({
      slotIndex: round.slotIndex,
      assetCodes: round.entries.map((entry) => entry.item.assetCode)
    }))).toEqual([
      { slotIndex: 2, assetCodes: ["a1", "a2"] },
      { slotIndex: 3, assetCodes: ["a1", "a2"] },
      { slotIndex: 4, assetCodes: ["a1", "a2"] },
      { slotIndex: 5, assetCodes: ["a1", "a2"] }
    ]);
  });

  it("uses an edited item prompt in the existing pending whole-chain column", () => {
    const pending = {
      one: state("one", ["ready", "idle"]),
      two: state("two", ["ready", "idle"])
    };
    pending.one = applyAiPromptDraftToGeneratableCandidates(pending.one, "edited one");

    const rounds = buildGptImage2GenerationRounds(items, pending);

    expect(pending.one.candidates).toHaveLength(2);
    expect(pending.two.candidates).toHaveLength(2);
    expect(rounds).toEqual([{
      slotIndex: 1,
      entries: [
        { item: items[0], promptText: "edited one" },
        { item: items[1] }
      ]
    }]);
  });
});

function state(itemKey: string, statuses: Array<"idle" | "ready" | "failed">): AiItemState {
  return {
    itemKey,
    candidates: statuses.map((status, index) => ({
      id: `${itemKey}:${index}`,
      label: String(index + 1),
      status
    }))
  };
}
