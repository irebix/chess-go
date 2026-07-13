import { UserCancelledError } from "./errors";

export function normalizeGenerationError(error: unknown, completed: number, total: number): unknown {
  if (!isCancellationError(error)) return error;
  return new UserCancelledError(`已取消生成，完成 ${completed}/${total}。`);
}

export function isCancellationError(error: unknown): boolean {
  if (error instanceof UserCancelledError) return true;
  const message = error instanceof Error ? error.message : String(error);
  return /(?:cancel(?:led|ed)?|用户.*取消|取消.*生成|[-–]128)/i.test(message);
}
