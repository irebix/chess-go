param(
  [string]$ReleaseRepo = (Join-Path $PSScriptRoot "..\..\ChessGo-Release"),
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$distFolder = Join-Path $projectRoot "dist"
$runtimeFiles = @(
  "manifest.json",
  "Holopix.json",
  "GptImage2.json",
  "index.html",
  "main.js",
  "main.js.LICENSE.txt",
  "styles.css"
)

if (-not $SkipBuild) {
  Push-Location $projectRoot
  try {
    & pnpm build
    if ($LASTEXITCODE -ne 0) {
      throw "Plugin build failed. Release repository was not updated."
    }
  } finally {
    Pop-Location
  }
}

if (-not (Test-Path -LiteralPath $ReleaseRepo)) {
  New-Item -ItemType Directory -Path $ReleaseRepo | Out-Null
}

foreach ($fileName in $runtimeFiles) {
  $source = Join-Path $distFolder $fileName
  if (-not (Test-Path -LiteralPath $source)) {
    throw "Missing build output: $source"
  }
  Copy-Item -LiteralPath $source -Destination (Join-Path $ReleaseRepo $fileName) -Force
}

$installerSource = Join-Path $projectRoot "installer\install.cmd"
if (-not (Test-Path -LiteralPath $installerSource)) {
  throw "Missing installer: $installerSource"
}
Copy-Item -LiteralPath $installerSource -Destination (Join-Path $ReleaseRepo "install.cmd") -Force

Write-Host "ChessGo runtime files synced to: $ReleaseRepo"
