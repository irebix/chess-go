import { describe, expect, it } from "vitest";
import { buildGptImage2GenerationRounds } from "../src/domain/gptImage2Generation";
import type { AiItemState } from "../src/domain/aiCandidates";

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
