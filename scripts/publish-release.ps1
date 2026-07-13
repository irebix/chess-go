param(
  [string]$ReleaseRepo = (Join-Path $PSScriptRoot "..\..\ChessGo-Release"),
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$distFolder = Join-Path $projectRoot "dist"
$runtimeFiles = @(
  "manifest.json",
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

Write-Host "ChessGo runtime files synced to: $ReleaseRepo"
