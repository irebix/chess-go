import { describe, expect, it } from "vitest";
import { aiPromptDraftKey, resolveAiPromptDraft } from "../src/domain/aiPromptDrafts";

describe("AI prompt drafts", () => {
  const base = {
    documentId: 42,
    documentIdentity: "file:d:/work/cleaning.psd",
    workflowVersion: "flux" as const
  };

  it("restores the edited text after switching to another item and back", () => {
    const firstKey = aiPromptDraftKey({
      ...base,
      artboardId: 1,
      assetCode: "c_cleaning1"
    });
    const secondKey = aiPromptDraftKey({
      ...base,
      artboardId: 2,
      assetCode: "c_cleaning2"
    });
    const drafts = new Map([[firstKey, "用户修改后的清洁布提示词"]]);

    expect(resolveAiPromptDraft(drafts, secondKey, "海绵块运行时提示词"))
      .toBe("海绵块运行时提示词");
    expect(resolveAiPromptDraft(drafts, firstKey, "清洁布原始提示词"))
      .toBe("用户修改后的清洁布提示词");
  });

  it("isolates drafts by workflow while keeping them stable across reference changes", () => {
    const fluxKey = aiPromptDraftKey({
      ...base,
      artboardId: 1,
      assetCode: "c_cleaning1"
    });
    const gptKey = aiPromptDraftKey({
      ...base,
      workflowVersion: "gpt-image-2",
      artboardId: 1,
      assetCode: "c_cleaning1"
    });
    const drafts = new Map([[fluxKey, "Flux 草稿"]]);

    expect(resolveAiPromptDraft(drafts, fluxKey, "新的运行时提示词")).toBe("Flux 草稿");
    expect(resolveAiPromptDraft(drafts, gptKey, "GPT 默认描述")).toBe("GPT 默认描述");
  });
});
