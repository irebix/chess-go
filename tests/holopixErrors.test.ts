import { describe, expect, it } from "vitest";
import {
  HolopixGenerationOutcomeUnknownError,
  isAmbiguousSubmissionTransportError
} from "../src/ai/holopixErrors";

describe("Holopix paid submission outcome errors", () => {
  it("keeps prompt and submission identities on an unknown outcome", () => {
    const error = new HolopixGenerationOutcomeUnknownError("result unknown", {
      promptId: "prompt-42",
      submissionKey: "request-42"
    });

    expect(error.name).toBe("HolopixGenerationOutcomeUnknownError");
    expect(error.promptId).toBe("prompt-42");
    expect(error.submissionKey).toBe("request-42");
  });

  it("treats only ambiguous transport failures as potentially submitted", () => {
    const aborted = new Error("stopped");
    aborted.name = "AbortError";

    expect(isAmbiguousSubmissionTransportError(aborted)).toBe(true);
    expect(isAmbiguousSubmissionTransportError(new Error("连接局域网 ComfyUI 超时（30 秒）。"))).toBe(true);
    expect(isAmbiguousSubmissionTransportError(new Error("无法连接局域网 ComfyUI：http failed"))).toBe(true);
    expect(isAmbiguousSubmissionTransportError(new Error("ComfyUI 未返回 prompt_id。"))).toBe(true);
    expect(isAmbiguousSubmissionTransportError(new Error("ComfyUI HTTP 500：internal"))).toBe(true);
    expect(isAmbiguousSubmissionTransportError(new Error("ComfyUI HTTP 502：gateway"))).toBe(true);
    expect(isAmbiguousSubmissionTransportError(new Error("ComfyUI HTTP 504：timeout"))).toBe(true);
    expect(isAmbiguousSubmissionTransportError(new Error("ComfyUI HTTP 408：timeout"))).toBe(true);
    expect(isAmbiguousSubmissionTransportError(new Error("ComfyUI HTTP 400"))).toBe(false);
    expect(isAmbiguousSubmissionTransportError(new Error("Holopix 节点执行失败"))).toBe(false);
  });
});
