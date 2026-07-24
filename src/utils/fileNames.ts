const WINDOWS_RESERVED = /[<>:"/\\|?*\u0000-\u001f]/g;

export function sanitizeFileName(value: string, fallback = "archive"): string {
  const cleaned = value.replace(WINDOWS_RESERVED, "_").replace(/[. ]+$/g, "").trim();
  return cleaned || fallback;
}

export function workbookStem(fileName: string): string {
  return sanitizeFileName(fileName.replace(/\.xlsx$/i, ""));
}

export interface VolumeOutputNames {
  volumeNumber: number;
  psd: string;
}

export function defaultBatchBaseName(workbookName: string, sheetName: string): string {
  return sanitizeFileName(`${workbookStem(workbookName)}_${sheetName}`);
}

export function defaultTableGridBaseName(workbookName: string, sheetName: string): string {
  return sanitizeFileName(`${workbookStem(workbookName)}_${sheetName}_网格`);
}

export function buildBatchOutputNames(requestedBaseName: string, volumeCount: number): VolumeOutputNames[] {
  const baseName = sanitizeFileName(requestedBaseName);
  return Array.from({ length: volumeCount }, (_, index) => {
    const volumeNumber = index + 1;
    const suffix = String(volumeNumber).padStart(2, "0");
    return {
      volumeNumber,
      psd: `${baseName}_${suffix}.psd`
    };
  });
}

export function buildBatchOutputNamesFromFirstPsd(firstPsdName: string, volumeCount: number): VolumeOutputNames[] {
  const firstStem = sanitizeFileName(firstPsdName.replace(/\.psd$/i, ""));
  const numberedBase = volumeCount > 1 && /_01$/i.test(firstStem)
    ? firstStem.slice(0, -3)
    : firstStem;
  return Array.from({ length: volumeCount }, (_, index) => {
    const volumeNumber = index + 1;
    const stem = index === 0
      ? firstStem
      : `${numberedBase}_${String(volumeNumber).padStart(2, "0")}`;
    return {
      volumeNumber,
      psd: `${stem}.psd`
    };
  });
}

export function findOutputNameConflicts(plannedNames: string[], existingNames: string[]): string[] {
  const existing = new Set(existingNames.map((name) => name.toLocaleLowerCase()));
  return plannedNames.filter((name) => existing.has(name.toLocaleLowerCase()));
}
