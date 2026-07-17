export class HolopixGenerationOutcomeUnknownError extends Error {
  readonly promptId?: string;
  readonly submissionKey?: string;

  constructor(message: string, options: { promptId?: string; submissionKey?: string } = {}) {
    super(message);
    this.name = "HolopixGenerationOutcomeUnknownError";
    this.promptId = options.promptId;
    this.submissionKey = options.submissionKey;
  }
}

export function isAmbiguousSubmissionTransportError(error: unknown): boolean {
  if (error instanceof Error && error.name === "AbortError") return true;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("连接局域网 ComfyUI 超时")
    || message.includes("无法连接局域网 ComfyUI")
    || message.includes("ComfyUI 未返回 prompt_id")
    || /ComfyUI HTTP (?:408|5\d\d)\b/.test(message);
}
