export class UserCancelledError extends Error {
  constructor(message = "用户取消了操作。") {
    super(message);
    this.name = "UserCancelledError";
  }
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
