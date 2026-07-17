import type { AiGeneratedImage } from "../domain/aiCandidates";

export type HolopixSubmissionLifecycleEvent = {
  state: "started" | "confirmed" | "resolved";
  submissionKey: string;
  completedBeforeBatch: number;
  batchSize: number;
  createdAt: number;
  promptId?: string;
  promptText?: string;
  outcome?: "output" | "failed";
  images?: AiGeneratedImage[];
};

export function notifyHolopixSubmissionLifecycle(
  callback: ((event: HolopixSubmissionLifecycleEvent) => void) | undefined,
  event: HolopixSubmissionLifecycleEvent,
  onWarning?: (message: string) => void
): void {
  if (!callback) return;
  try {
    callback(event);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (event.state === "started") {
      throw new Error(
        `无法安全记录 Holopix 待确认提交；付费生成请求未发送。${detail}`
      );
    }
    onWarning?.(`记录 Holopix 提交状态失败：${detail}`);
  }
}
