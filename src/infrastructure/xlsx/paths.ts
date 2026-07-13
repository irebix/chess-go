export function normalizeArchivePath(baseEntry: string, target: string): string {
  const normalizedTarget = target.replace(/\\/g, "/");
  const baseParts = baseEntry.replace(/\\/g, "/").split("/");
  baseParts.pop();

  const output = normalizedTarget.startsWith("/") ? [] : baseParts;
  for (const part of normalizedTarget.split("/")) {
    if (!part || part === ".") {
      continue;
    }
    if (part === "..") {
      output.pop();
      continue;
    }
    output.push(part);
  }
  return output.join("/");
}

export function normalizeZipEntryName(entryName: string): string {
  return entryName.replace(/\\/g, "/").replace(/^\/+/, "");
}
