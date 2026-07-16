import { describe, expect, it } from "vitest";
import { assertHolopixCandidateUrl } from "../src/ai/holopixExternalUrl";

describe("Holopix external candidate URL", () => {
  it("allows only the configured LAN ComfyUI view endpoint", () => {
    const value = assertHolopixCandidateUrl(
      "http://192.168.1.32:8188/view?filename=a.png&subfolder=Holopix%2FChessGo&type=output"
    );
    const url = new URL(value);
    expect(url.origin).toBe("http://192.168.1.32:8188");
    expect(url.pathname).toBe("/view");
    expect(url.searchParams.get("filename")).toBe("a.png");
  });

  it("rejects other origins, paths and missing filenames", () => {
    expect(() => assertHolopixCandidateUrl("https://example.com/view?filename=a.png"))
      .toThrow(/局域网 ComfyUI/);
    expect(() => assertHolopixCandidateUrl("http://127.0.0.1:8188/history?filename=a.png"))
      .toThrow(/局域网 ComfyUI/);
    expect(() => assertHolopixCandidateUrl("http://192.168.1.32:8188/view"))
      .toThrow(/缺少文件名/);
  });
});
