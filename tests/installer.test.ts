import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const installer = readFileSync(resolve(process.cwd(), "installer/install.cmd"), "utf8");

const requiredRuntimeFiles = [
  "manifest.json",
  "Holopix.json",
  "GptImage2.json",
  "ImageEditor.json",
  "ImageRefiner.json",
  "ImageRefinerStyle.png",
  "index.html",
  "main.js",
  "main.js.LICENSE.txt",
  "styles.css"
] as const;

describe("Windows installer", () => {
  it("advances the installer revision after expanding the runtime payload", () => {
    expect(installer).toContain('set "CHESSGO_INSTALLER_REVISION=2"');
  });

  it("installs every bundled runtime resource", () => {
    for (const fileName of requiredRuntimeFiles) {
      expect(installer).toContain(`"${fileName}"`);
    }
  });

  it("refreshes a changed installer even when its revision was not advanced", () => {
    expect(installer).toContain("if ($candidateRevision -lt $currentRevision)");
    expect(installer).toContain(
      "if ($candidateRevision -eq $currentRevision -and $candidateContent -ceq $currentContent)"
    );
  });
});
