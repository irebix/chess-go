import { buildParsingManifest, type ParsingManifestInput } from "../domain/parsingManifest";
import { writeJsonOutput } from "../infrastructure/filesystem/uxpFiles";
import { sanitizeFileName, workbookStem } from "../utils/fileNames";

export async function exportParsingManifest(input: ParsingManifestInput): Promise<string> {
  const defaultName = sanitizeFileName(
    `${workbookStem(input.workbook.sourceName)}_${input.sheetName}.parse-manifest.json`
  );
  const file = await writeJsonOutput(defaultName, JSON.stringify(buildParsingManifest(input), null, 2));
  return file.name;
}
