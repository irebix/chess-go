import { describe, expect, it } from "vitest";
import {
  AI_WORKFLOW_VERSIONS,
  aiWorkflowVersionLabel,
  normalizedAiWorkflowVersion
} from "../src/ai/aiWorkflowVersion";

describe("AI workflow versions", () => {
  it("exposes the G+F chain as an isolated third workflow", () => {
    expect(AI_WORKFLOW_VERSIONS).toEqual(["flux", "gpt-image-2", "g-plus-f"]);
    expect(aiWorkflowVersionLabel("g-plus-f")).toBe("G+F");
    expect(normalizedAiWorkflowVersion("g-plus-f")).toBe("g-plus-f");
  });

  it("keeps legacy and unknown values backward compatible", () => {
    expect(normalizedAiWorkflowVersion("gpt-image-2")).toBe("gpt-image-2");
    expect(normalizedAiWorkflowVersion("unknown")).toBe("flux");
    expect(normalizedAiWorkflowVersion(undefined)).toBe("flux");
  });
});
