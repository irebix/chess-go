import { storage } from "uxp";
import {
  parseRecentWorkbookRecord,
  RECENT_WORKBOOK_STORAGE_KEY,
  type RecentWorkbookRecord
} from "../domain/recentWorkbook";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function loadRecentWorkbookRecord(store: StorageLike = localStorage): RecentWorkbookRecord | null {
  try {
    return parseRecentWorkbookRecord(store.getItem(RECENT_WORKBOOK_STORAGE_KEY));
  } catch {
    return null;
  }
}

export async function rememberWorkbook(
  file: storage.File,
  store: StorageLike = localStorage
): Promise<RecentWorkbookRecord | null> {
  const provider = storage.localFileSystem;
  if (!provider.createPersistentToken) return null;
  const token = await provider.createPersistentToken(file);
  const record: RecentWorkbookRecord = {
    version: 1,
    token,
    name: file.name,
    rememberedAt: new Date().toISOString()
  };
  store.setItem(RECENT_WORKBOOK_STORAGE_KEY, JSON.stringify(record));
  return record;
}

export async function restoreWorkbook(record: RecentWorkbookRecord): Promise<storage.File> {
  const provider = storage.localFileSystem;
  if (!provider.getEntryForPersistentToken) {
    throw new Error("当前 Photoshop/UXP 版本不支持恢复最近文件，请重新选择 XLSX。");
  }
  const entry = await provider.getEntryForPersistentToken(record.token);
  if (!("read" in entry) || !entry.name.toLowerCase().endsWith(".xlsx")) {
    throw new Error("最近文件不是可读取的 XLSX，请重新选择文件。");
  }
  return entry as storage.File;
}

export function clearRecentWorkbook(store: StorageLike = localStorage): void {
  store.removeItem(RECENT_WORKBOOK_STORAGE_KEY);
}
