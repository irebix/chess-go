import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const installer = readFileSync(resolve(process.cwd(), "installer/install.cmd"), "utf8");
const publisher = readFileSync(resolve(process.cwd(), "scripts/publish-release.ps1"), "utf8");

describe("Windows installer", () => {
  it("advances the installer revision for manifest-driven payload installation", () => {
    expect(installer).toContain('set "CHESSGO_INSTALLER_REVISION=3"');
  });

  it("discovers and verifies every runtime file from the generated release manifest", () => {
    expect(installer).toContain('$releaseManifestName = "release-manifest.json"');
    expect(installer).toContain("function Get-ChessGoReleasePayload");
    expect(installer).toContain("Get-FileHash -LiteralPath $safeSourcePath -Algorithm SHA256");
    expect(installer).toContain("foreach ($payloadFile in $payloadFiles)");
    expect(installer).not.toContain("$requiredFiles = @(");
  });

  it("publishes every dist file recursively without maintaining an asset allowlist", () => {
    expect(publisher).toContain("Get-ChildItem -LiteralPath $distFolder -File -Recurse");
    expect(publisher).toContain('$releaseManifestName = "release-manifest.json"');
    expect(publisher).toContain('[IO.File]::WriteAllText($releaseAttributesPath, "* binary`r`n"');
    expect(publisher).toContain("sha256 = $_.Sha256");
    expect(publisher).not.toContain('"ImageRefiner.json"');
    expect(publisher).not.toContain('"GPlusF.json"');
  });

  it("refreshes a changed installer even when its revision was not advanced", () => {
    expect(installer).toContain("if ($candidateRevision -lt $currentRevision)");
    expect(installer).toContain(
      "if ($candidateRevision -eq $currentRevision -and $candidateContent -ceq $currentContent)"
    );
  });
});
