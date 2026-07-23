param(
  [string]$ReleaseRepo = (Join-Path $PSScriptRoot "..\..\ChessGo-Release"),
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$distFolder = Join-Path $projectRoot "dist"
$releaseManifestName = "release-manifest.json"
$releaseAttributesName = ".gitattributes"
$requiredRuntimeFiles = @("manifest.json", "index.html", "main.js", "styles.css")

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

$releaseAttributesPath = Join-Path $ReleaseRepo $releaseAttributesName
[IO.File]::WriteAllText($releaseAttributesPath, "* -text`r`n", [Text.Encoding]::ASCII)

if (-not (Test-Path -LiteralPath $distFolder -PathType Container)) {
  throw "Missing build output folder: $distFolder"
}

$runtimeFiles = @(
  Get-ChildItem -LiteralPath $distFolder -File -Recurse |
    ForEach-Object {
      $relativePath = [IO.Path]::GetRelativePath($distFolder, $_.FullName).Replace("\", "/")
      [pscustomobject]@{
        Path = $relativePath
        SourcePath = $_.FullName
        Size = [int64]$_.Length
        Sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
      }
    } |
    Sort-Object Path
)
if ($runtimeFiles.Count -eq 0) {
  throw "The build output folder is empty: $distFolder"
}

$runtimePaths = @($runtimeFiles | ForEach-Object { $_.Path })
foreach ($requiredFile in $requiredRuntimeFiles) {
  if ($runtimePaths -notcontains $requiredFile) {
    throw "Missing required build output: $requiredFile"
  }
}

foreach ($runtimeFile in $runtimeFiles) {
  $destination = Join-Path $ReleaseRepo ($runtimeFile.Path.Replace("/", "\"))
  $destinationParent = Split-Path -Parent $destination
  if (-not (Test-Path -LiteralPath $destinationParent -PathType Container)) {
    New-Item -ItemType Directory -Path $destinationParent -Force | Out-Null
  }
  Copy-Item -LiteralPath $runtimeFile.SourcePath -Destination $destination -Force
  $copiedHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($copiedHash -ne $runtimeFile.Sha256) {
    throw "Published file verification failed: $($runtimeFile.Path)"
  }
}

$pluginManifest = Get-Content -LiteralPath (Join-Path $distFolder "manifest.json") -Raw -Encoding utf8 | ConvertFrom-Json
$releaseManifest = [ordered]@{
  schemaVersion = 1
  pluginId = [string]$pluginManifest.id
  pluginVersion = [string]$pluginManifest.version
  files = @(
    $runtimeFiles | ForEach-Object {
      [ordered]@{
        path = $_.Path
        size = $_.Size
        sha256 = $_.Sha256
      }
    }
  )
}
$releaseManifestPath = Join-Path $ReleaseRepo $releaseManifestName
$releaseManifestJson = $releaseManifest | ConvertTo-Json -Depth 10
[IO.File]::WriteAllText($releaseManifestPath, $releaseManifestJson, [Text.UTF8Encoding]::new($false))

$installerSource = Join-Path $projectRoot "installer\install.cmd"
if (-not (Test-Path -LiteralPath $installerSource)) {
  throw "Missing installer: $installerSource"
}
Copy-Item -LiteralPath $installerSource -Destination (Join-Path $ReleaseRepo "install.cmd") -Force

Write-Host "ChessGo runtime files synced to: $ReleaseRepo ($($runtimeFiles.Count) files)"
