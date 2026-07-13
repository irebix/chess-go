import { storage } from "uxp";
import { UserCancelledError } from "../../utils/errors";

export interface SelectedXlsx {
  file: storage.File;
  name: string;
  size?: number;
  modifiedAt?: string;
  bytes: ArrayBuffer;
}

export async function selectXlsxFile(): Promise<SelectedXlsx> {
  const selected = await storage.localFileSystem.getFileForOpening({
    types: ["xlsx"],
    allowMultiple: false
  });
  const file = Array.isArray(selected) ? selected[0] : selected;
  if (!file) {
    throw new UserCancelledError("未选择 XLSX 文件。")
  }
  return readXlsxFile(file);
}

export async function readXlsxFile(file: storage.File): Promise<SelectedXlsx> {
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    throw new Error("请选择 .xlsx 文件；Phase 0 不支持 .xls 或其他格式。")
  }

  const raw = await file.read({ format: storage.formats.binary });
  if (typeof raw === "string") {
    throw new Error("UXP 未以二进制格式返回 XLSX 内容。")
  }
  const metadata = file.getMetadata ? await file.getMetadata() : undefined;

  return {
    file,
    name: file.name,
    size: metadata?.size,
    modifiedAt: metadata?.dateModified?.toISOString(),
    bytes: raw
  };
}

export async function selectPsdOutput(defaultName: string): Promise<storage.File> {
  const output = await storage.localFileSystem.getFileForSaving(defaultName, {
    types: ["psd"]
  });
  if (!output) {
    throw new UserCancelledError("未选择 PSD 保存位置。")
  }
  return output;
}

export async function parentFolderForFile(file: storage.File): Promise<storage.Folder> {
  const provider = storage.localFileSystem;
  const nativePath = file.nativePath ?? provider.getNativePath?.(file);
  const folderUrl = nativePath
    ? parentFolderUrlFromNativePath(nativePath)
    : parentFolderUrlFromFsUrl(normalizeFsUrl(provider.getFsUrl?.(file) ?? file.url));
  if (!folderUrl || !provider.getEntryWithUrl) {
    throw new Error("当前 UXP 无法取得所选 PSD 的父目录。");
  }
  const entry = await provider.getEntryWithUrl(folderUrl);
  if (entry.isFile || !(entry as storage.Folder).createFile) {
    throw new Error("无法访问所选 PSD 的保存目录。");
  }
  return entry as storage.Folder;
}

export async function listFolderFileNames(folder: storage.Folder): Promise<string[]> {
  if (!folder.getEntries) {
    throw new Error("当前 UXP 无法检查输出目录中的同名文件。");
  }
  const entries = await folder.getEntries();
  return entries.filter((entry) => Boolean(entry.isFile)).map((entry) => entry.name ?? "").filter(Boolean);
}

function normalizeFsUrl(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (!value || typeof value !== "object") return undefined;

  const href = (value as { href?: unknown }).href;
  if (typeof href === "string") return href;

  const normalized = String(value);
  return normalized && normalized !== "[object Object]" ? normalized : undefined;
}

function parentFolderUrlFromNativePath(nativePath: string): string | undefined {
  const normalized = nativePath.replace(/\\/g, "/");
  const separator = normalized.lastIndexOf("/");
  if (separator <= 0) return undefined;
  const parentPath = normalized.slice(0, separator);
  if (/^[A-Za-z]:\//.test(parentPath)) return `file:/${parentPath}`;
  if (parentPath.startsWith("//")) return `file:${parentPath}`;
  if (parentPath.startsWith("/")) return `file:${parentPath}`;
  return `file:/${parentPath}`;
}

function parentFolderUrlFromFsUrl(fileUrl: string | undefined): string | undefined {
  if (!fileUrl || /^blob:/i.test(fileUrl)) return undefined;
  const separator = fileUrl.lastIndexOf("/");
  if (separator <= fileUrl.indexOf(":")) return undefined;
  return fileUrl.slice(0, separator);
}

export async function writeJsonOutput(defaultName: string, contents: string): Promise<storage.File> {
  const output = await storage.localFileSystem.getFileForSaving(defaultName, {
    types: ["json"]
  });
  if (!output) throw new UserCancelledError("未选择解析 Manifest 保存位置。");
  await output.write(contents, { format: storage.formats.utf8 });
  return output;
}

export async function writeBinaryOutput(
  defaultName: string,
  contents: Uint8Array,
  types: string[]
): Promise<storage.File> {
  const output = await storage.localFileSystem.getFileForSaving(defaultName, { types });
  if (!output) throw new UserCancelledError("未选择诊断包保存位置。");
  await output.write(contents, { format: storage.formats.binary });
  return output;
}

export async function writeTemporaryImage(bytes: Uint8Array): Promise<storage.File> {
  const folder = await storage.localFileSystem.getTemporaryFolder();
  const file = await folder.createFile(`chess-archive-phase0-${Date.now()}.png`, {
    overwrite: true
  });
  const binary = new Uint8Array(bytes.byteLength);
  binary.set(bytes);
  await file.write(binary, { format: storage.formats.binary });
  return file;
}

export async function deleteTemporaryFile(file: storage.File): Promise<void> {
  try {
    await file.delete();
  } catch (error) {
    console.warn("清理 UXP 临时图片失败", error);
  }
}
