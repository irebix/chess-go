import { buildDiagnosticBundle, type DiagnosticBundleInput } from "../domain/diagnosticBundle";
import { writeBinaryOutput } from "../infrastructure/filesystem/uxpFiles";
import { sanitizeFileName, workbookStem } from "../utils/fileNames";

export async function exportDiagnosticPackage(input: DiagnosticBundleInput): Promise<string> {
  const sourceStem = input.workbook ? workbookStem(input.workbook.sourceName) : "chess-archive";
  const sheetSuffix = input.sheetName ? `_${input.sheetName}` : "";
  const defaultName = sanitizeFileName(`${sourceStem}${sheetSuffix}.diagnostics.zip`);
  const bytes = await buildDiagnosticBundle(input);
  const file = await writeBinaryOutput(defaultName, bytes, ["zip"]);
  return file.name;
}
