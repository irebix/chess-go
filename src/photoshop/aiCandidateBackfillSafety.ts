export interface HistorySuspensionHostControl {
  suspendHistory(options: { documentID: number; name: string }): Promise<unknown> | unknown;
  resumeHistory(suspensionId: unknown, commit?: boolean): Promise<void> | void;
}

interface BatchPlayErrorDescriptor {
  _obj?: unknown;
  result?: unknown;
  message?: unknown;
}

export function assertExpectedDocumentId(
  expectedDocumentId: number,
  actualDocumentId: number | undefined,
  stage: string
): void {
  if (actualDocumentId === expectedDocumentId) return;
  const actual = actualDocumentId === undefined ? "无" : String(actualDocumentId);
  throw new Error(
    `回填已停止：${stage}当前 PSD 与候选所属 PSD 不一致（预期文档 ${expectedDocumentId}，当前 ${actual}）。`
  );
}

export function assertSingleBatchPlaySucceeded(
  results: readonly unknown[],
  actionName: string
): void {
  if (results.length !== 1) {
    throw new Error(`${actionName}失败：Photoshop 未返回预期的执行结果。`);
  }
  const result = results[0] as BatchPlayErrorDescriptor | null | undefined;
  if (!result || typeof result !== "object") {
    throw new Error(`${actionName}失败：Photoshop 返回了无效的执行结果。`);
  }
  if (typeof result._obj !== "string" || result._obj.toLowerCase() !== "error" || result.result === 0) {
    return;
  }
  const detail = typeof result.message === "string" && result.message.trim()
    ? result.message.trim()
    : `错误 ${formatErrorCode(result.result)}`;
  throw new Error(`${actionName}失败：${detail}`);
}

export async function runWithRollbackHistory<T>(
  hostControl: HistorySuspensionHostControl,
  options: { documentID: number; name: string },
  operation: () => Promise<T>
): Promise<T> {
  const suspensionId = await hostControl.suspendHistory(options);
  try {
    const result = await operation();
    await hostControl.resumeHistory(suspensionId, true);
    return result;
  } catch (error) {
    try {
      await hostControl.resumeHistory(suspensionId, false);
    } catch (rollbackError) {
      const combined = new Error(
        `${errorMessage(error)}；Photoshop 回滚失败：${errorMessage(rollbackError)}`
      ) as Error & { cause?: unknown };
      combined.cause = error;
      throw combined;
    }
    throw error;
  }
}

function formatErrorCode(value: unknown): string {
  if (typeof value === "number" || typeof value === "string") return String(value);
  return "未知";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
