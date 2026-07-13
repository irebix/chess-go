import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  extractKnownImage,
  hasPngSignature,
  PHASE_ZERO_IMAGE_ENTRY
} from "../src/infrastructure/xlsx/extractKnownImage";

const fixtureUrl = new URL("../fixtures/tencent-export-minimal.xlsx", import.meta.url);

describe("Phase 0 XLSX extraction", () => {
  it("extracts the hard-coded Tencent media entry without reading styles", async () => {
    const fixture = await readFile(fileURLToPath(fixtureUrl));
    const result = await extractKnownImage(new Uint8Array(fixture));

    expect(result.entryName).toBe(PHASE_ZERO_IMAGE_ENTRY);
    expect(result.archiveEntries).toContain(PHASE_ZERO_IMAGE_ENTRY);
    expect(result.archiveEntries).not.toContain("xl/styles.xml");
    expect(hasPngSignature(result.bytes)).toBe(true);
  });

  it("reports a missing entry explicitly", async () => {
    const fixture = await readFile(fileURLToPath(fixtureUrl));
    await expect(extractKnownImage(new Uint8Array(fixture), "xl/media/missing.png")).rejects.toThrow(
      "未找到 Phase 0 图片入口"
    );
  });
});
