export class ThumbnailCache {
  private readonly values = new Map<string, string>();

  constructor(private readonly maxEntries = 100) {
    if (!Number.isInteger(maxEntries) || maxEntries < 1) {
      throw new Error("缩略图缓存上限必须是正整数。");
    }
  }

  get size(): number {
    return this.values.size;
  }

  get(key: string): string | undefined {
    const value = this.values.get(key);
    if (value === undefined) return undefined;
    this.values.delete(key);
    this.values.set(key, value);
    return value;
  }

  set(key: string, value: string): void {
    this.values.delete(key);
    this.values.set(key, value);
    while (this.values.size > this.maxEntries) {
      const oldest = this.values.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.values.delete(oldest);
    }
  }

  delete(key: string): void {
    this.values.delete(key);
  }

  clear(): void {
    this.values.clear();
  }
}
