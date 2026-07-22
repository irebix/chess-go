export interface ImageRefinerUploadResponse {
  name?: string;
  subfolder?: string;
}

export interface ImageRefinerUploadedInput {
  filename: string;
}

export function resolveImageRefinerUploadPath(
  value: ImageRefinerUploadResponse,
  runSubfolder: string,
  expectedItemSubfolder: string
): ImageRefinerUploadedInput {
  const filename = String(value.name ?? "").trim();
  const subfolder = normalizeFolder(value.subfolder);
  const run = normalizeFolder(runSubfolder);
  const item = normalizeFolder(expectedItemSubfolder);
  if (!filename || filename === "." || filename === ".." || filename.includes("/") || filename.includes("\\")) {
    throw new Error("ComfyUI 返回了不安全的 AI细化上传路径。");
  }
  const runParts = folderParts(run);
  const itemParts = folderParts(item);
  if (
    !runParts.length
    || itemParts.length !== runParts.length + 1
    || runParts.some((part, index) => itemParts[index] !== part)
  ) {
    throw new Error("AI细化上传目录无效。");
  }
  if (subfolder !== item) {
    throw new Error(`ComfyUI 将 AI细化输入保存到了意外目录：${subfolder}。`);
  }
  return { filename: `${itemParts[itemParts.length - 1]}/${filename}` };
}

function normalizeFolder(value: unknown): string {
  return String(value ?? "").trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
}

function folderParts(value: string): string[] {
  const parts = value.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) return [];
  return parts;
}
