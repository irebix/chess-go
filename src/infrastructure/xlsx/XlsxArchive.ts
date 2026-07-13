import JSZip from "jszip";
import { normalizeZipEntryName } from "./paths";

export class XlsxArchive {
  private constructor(private readonly zip: JSZip) {}

  static async open(input: ArrayBuffer | Uint8Array): Promise<XlsxArchive> {
    return new XlsxArchive(await JSZip.loadAsync(input));
  }

  listEntries(): string[] {
    return Object.keys(this.zip.files)
      .filter((name) => !this.zip.files[name]?.dir)
      .map(normalizeZipEntryName)
      .sort();
  }

  has(entryName: string): boolean {
    return this.zip.file(normalizeZipEntryName(entryName)) !== null;
  }

  async readText(entryName: string): Promise<string> {
    const normalized = normalizeZipEntryName(entryName);
    const entry = this.zip.file(normalized);
    if (!entry) throw new Error(`XLSX 缺少 entry：${normalized}`);
    return entry.async("string");
  }

  async readBinary(entryName: string): Promise<Uint8Array> {
    const normalized = normalizeZipEntryName(entryName);
    const entry = this.zip.file(normalized);
    if (!entry) throw new Error(`XLSX 缺少图片 entry：${normalized}`);
    return entry.async("uint8array");
  }
}
