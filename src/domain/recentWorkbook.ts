export const RECENT_WORKBOOK_STORAGE_KEY = "chess-archive.recent-workbook.v1";

export interface RecentWorkbookRecord {
  version: 1;
  token: string;
  name: string;
  rememberedAt: string;
}

export function parseRecentWorkbookRecord(raw: string | null): RecentWorkbookRecord | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<RecentWorkbookRecord>;
    if (value.version !== 1 || typeof value.token !== "string" || !value.token.trim()) return null;
    if (typeof value.name !== "string" || !value.name.toLowerCase().endsWith(".xlsx")) return null;
    if (typeof value.rememberedAt !== "string") return null;
    return {
      version: 1,
      token: value.token,
      name: value.name,
      rememberedAt: value.rememberedAt
    };
  } catch {
    return null;
  }
}
