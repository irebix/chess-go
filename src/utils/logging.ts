export type LogLevel = "info" | "warn" | "error";

export interface LogEvent {
  timestamp: string;
  level: LogLevel;
  event: string;
  detail?: string;
}

export function makeLog(level: LogLevel, event: string, detail?: string): LogEvent {
  return {
    timestamp: new Date().toISOString(),
    level,
    event,
    detail
  };
}

export function formatLog(event: LogEvent): string {
  const suffix = event.detail ? ` · ${event.detail}` : "";
  return `${event.timestamp} [${event.level.toUpperCase()}] ${event.event}${suffix}`;
}
