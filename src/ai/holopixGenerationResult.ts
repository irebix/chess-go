import type { AiGeneratedImage } from "../domain/aiCandidates";

export interface HolopixHistoryImage {
  filename?: string;
  subfolder?: string;
  type?: string;
}

interface HolopixHistoryOutput {
  images?: HolopixHistoryImage[];
  text?: unknown;
  string?: unknown;
  value?: unknown;
  result?: unknown;
  output?: unknown;
}

export interface HolopixHistoryEntry {
  outputs?: Record<string, HolopixHistoryOutput>;
  status?: {
    completed?: boolean;
    status_str?: string;
    messages?: unknown[];
  };
}

export type HolopixHistoryDecision =
  | { kind: "pending" }
  | { kind: "failed"; error: string }
  | {
      kind: "complete";
      images: HolopixHistoryImage[];
      promptText?: string;
      terminalError?: string;
    };

export interface HolopixPaidBatchAssessment {
  imagesToPreserve: AiGeneratedImage[];
  resolvedPromptText?: string;
  promptMismatchError?: string;
}

export function interpretHolopixHistoryEntry(
  entry: HolopixHistoryEntry,
  saveNodeId: string,
  promptCaptureNodeId: string,
  expectedImageCount: number
): HolopixHistoryDecision {
  const images = entry.outputs?.[saveNodeId]?.images ?? [];
  const promptText = extractCapturedPrompt(entry.outputs?.[promptCaptureNodeId]);
  const executionError = findHolopixExecutionError(entry.status?.messages);
  if (executionError) {
    if (!images.length) return { kind: "failed", error: executionError };
    return completeDecision(images, promptText, executionError);
  }
  if (entry.status?.status_str === "error") {
    const error = "Holopix 工作流以错误状态结束。";
    if (!images.length) return { kind: "failed", error };
    return completeDecision(images, promptText, error);
  }
  if (images.length >= expectedImageCount && promptText) {
    return { kind: "complete", images, promptText };
  }
  if (!entry.status?.completed) return { kind: "pending" };
  if (!images.length) {
    return { kind: "failed", error: "Holopix 工作流已结束，但 SaveImage 节点没有输出图片。" };
  }
  return completeDecision(
    images,
    promptText,
    promptText
      ? undefined
      : "Holopix 工作流已生成图片，但“提示词结果”没有记录实际提示词。"
  );
}

export function assessHolopixPaidBatch(
  images: AiGeneratedImage[],
  batchSize: number,
  expectedPromptText?: string,
  capturedPromptText?: string
): HolopixPaidBatchAssessment {
  const expected = expectedPromptText?.trim() || undefined;
  const captured = capturedPromptText?.trim() || undefined;
  const resolvedPromptText = expected ?? captured;
  const promptMismatchError = expected && captured && captured !== expected
    ? "Holopix 后续批次没有沿用首批 QwenVL 提示词。"
    : undefined;
  return {
    imagesToPreserve: images.slice(0, batchSize).map((image) => ({
      ...image,
      ...(resolvedPromptText ? { promptText: resolvedPromptText } : {})
    })),
    ...(resolvedPromptText ? { resolvedPromptText } : {}),
    ...(promptMismatchError ? { promptMismatchError } : {})
  };
}

function completeDecision(
  images: HolopixHistoryImage[],
  promptText?: string,
  terminalError?: string
): HolopixHistoryDecision {
  return {
    kind: "complete",
    images,
    ...(promptText ? { promptText } : {}),
    ...(terminalError ? { terminalError } : {})
  };
}

function extractCapturedPrompt(value: unknown): string | undefined {
  if (typeof value === "string") return value.trim() || undefined;
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = extractCapturedPrompt(item);
      if (text) return text;
    }
    return undefined;
  }
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  for (const key of ["text", "string", "value", "result", "output"]) {
    const text = extractCapturedPrompt(record[key]);
    if (text) return text;
  }
  return undefined;
}

export function findHolopixExecutionError(messages: unknown[] | undefined): string | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (const message of messages) {
    if (!Array.isArray(message) || message[0] !== "execution_error") continue;
    const detail = message[1];
    if (detail && typeof detail === "object") {
      const record = detail as Record<string, unknown>;
      return `Holopix 节点执行失败：${String(record.exception_message ?? record.error ?? JSON.stringify(record))}`;
    }
    return `Holopix 节点执行失败：${String(detail)}`;
  }
  return undefined;
}
