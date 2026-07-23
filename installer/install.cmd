@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "CHESSGO_INSTALLER_REVISION=2"
set "CHESSGO_INSTALLER=%~f0"
set "CHESSGO_PWSH="
where pwsh.exe >nul 2>nul
if not errorlevel 1 set "CHESSGO_PWSH=pwsh.exe"
if not defined CHESSGO_PWSH if exist "%ProgramFiles%\PowerShell\7\pwsh.exe" set "CHESSGO_PWSH=%ProgramFiles%\PowerShell\7\pwsh.exe"
if not defined CHESSGO_PWSH (
  echo PowerShell 7 is required. Installing it with Windows Package Manager...
  where winget.exe >nul 2>nul
  if errorlevel 1 (
    echo PowerShell 7 was not found, and winget.exe is unavailable.
    exit /b 1
  )
  winget.exe install --id Microsoft.PowerShell --exact --source winget --accept-source-agreements --accept-package-agreements --silent
  if errorlevel 1 exit /b 1
  if exist "%ProgramFiles%\PowerShell\7\pwsh.exe" set "CHESSGO_PWSH=%ProgramFiles%\PowerShell\7\pwsh.exe"
)
if not defined CHESSGO_PWSH (
  echo PowerShell 7 installation completed, but pwsh.exe could not be located. Restart Windows and run this installer again.
  exit /b 1
)
set "CHESSGO_UPDATE_FILE=%CHESSGO_INSTALLER%.chessgo-update"
if /I not "%CHESSGO_SELF_UPDATE_RESTARTED%"=="1" if /I not "%CHESSGO_SKIP_SELF_UPDATE%"=="1" (
  "%CHESSGO_PWSH%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$begin=':__CHESSGO_SELF_UPDATE_POWERSHELL__'; $end=':__CHESSGO_POWERSHELL__'; $raw=[IO.File]::ReadAllText($env:CHESSGO_INSTALLER, [Text.Encoding]::UTF8); $start=$raw.LastIndexOf($begin); $finish=$raw.LastIndexOf($end); if($start -lt 0 -or $finish -le $start){throw 'Installer self-update payload was not found.'}; Invoke-Expression $raw.Substring($start+$begin.Length,$finish-($start+$begin.Length))"
  if errorlevel 20 if not errorlevel 21 (
    "%CHESSGO_PWSH%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$current=[IO.Path]::GetFullPath($env:CHESSGO_INSTALLER); $candidate=[IO.Path]::GetFullPath($env:CHESSGO_UPDATE_FILE); $backup=$current+'.previous'; if(Test-Path -LiteralPath $backup -PathType Leaf){Remove-Item -LiteralPath $backup -Force}; [IO.File]::Replace($candidate,$current,$backup,$true)"
    if errorlevel 1 (
      if exist "%CHESSGO_UPDATE_FILE%" del /f /q "%CHESSGO_UPDATE_FILE%" >nul 2>nul
      echo Warning: the latest installer was downloaded but could not replace the current file.
    ) else (
      set "CHESSGO_SELF_UPDATE_RESTARTED=1"
      "%ComSpec%" /d /c ""%CHESSGO_INSTALLER%""
      exit /b
    )
  )
)
if /I "%CHESSGO_SELF_UPDATE_ONLY%"=="1" exit /b 0
"%CHESSGO_PWSH%" -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$marker=':__CHESSGO_POWERSHELL__'; $raw=[IO.File]::ReadAllText($env:CHESSGO_INSTALLER, [Text.Encoding]::UTF8); $start=$raw.LastIndexOf($marker); if($start -lt 0){throw 'Installer payload was not found.'}; Invoke-Expression $raw.Substring($start+$marker.Length)"
set "CHESSGO_EXIT=%ERRORLEVEL%"
endlocal & exit /b %CHESSGO_EXIT%

:__CHESSGO_SELF_UPDATE_POWERSHELL__
$ErrorActionPreference = "Stop"
$installerPath = [IO.Path]::GetFullPath($env:CHESSGO_INSTALLER)
$candidatePath = [IO.Path]::GetFullPath($env:CHESSGO_UPDATE_FILE)
$releaseApiUrl = "https://api.github.com/repos/irebix/chess-go/commits/release"

function Get-InstallerRevision([string]$content, [string]$label) {
  $match = [regex]::Match(
    $content,
    '(?m)^set "CHESSGO_INSTALLER_REVISION=([0-9]+)"\s*$'
  )
  if (-not $match.Success) {
    throw "$label does not declare a ChessGo installer revision."
  }
  return [int64]$match.Groups[1].Value
}

function Assert-ChessGoInstaller([string]$content, [string]$label) {
  if ($content.Length -lt 10000) {
    throw "$label is unexpectedly small."
  }
  if (-not $content.TrimStart().StartsWith("@echo off", [StringComparison]::OrdinalIgnoreCase)) {
    throw "$label is not a CMD installer."
  }
  $selfUpdateMarkerText = ":__CHESSGO_" + "SELF_UPDATE_POWERSHELL__"
  $selfUpdateMarker = $content.LastIndexOf($selfUpdateMarkerText)
  $payloadMarker = $content.LastIndexOf(":__CHESSGO_POWERSHELL__")
  if ($selfUpdateMarker -lt 0 -or $payloadMarker -le $selfUpdateMarker) {
    throw "$label does not contain the required installer payload markers."
  }
  $payload = $content.Substring($payloadMarker + ":__CHESSGO_POWERSHELL__".Length)
  if (-not $payload.Contains('$pluginId = "com.linkdesks.chess-archive-psd-generator"')) {
    throw "$label is not a ChessGo installer."
  }
  $tokens = $null
  $parseErrors = $null
  [System.Management.Automation.Language.Parser]::ParseInput(
    $payload,
    [ref]$tokens,
    [ref]$parseErrors
  ) | Out-Null
  if ($parseErrors.Count -gt 0) {
    throw "$label contains an invalid PowerShell payload: $($parseErrors[0].Message)"
  }
}

try {
  if (Test-Path -LiteralPath $candidatePath) {
    Remove-Item -LiteralPath $candidatePath -Force
  }

  $currentContent = [IO.File]::ReadAllText($installerPath, [Text.Encoding]::UTF8)
  $currentRevision = Get-InstallerRevision $currentContent "The current installer"
  $testSource = [string]$env:CHESSGO_INSTALLER_UPDATE_SOURCE
  if (-not [string]::IsNullOrWhiteSpace($testSource)) {
    $testSource = [IO.Path]::GetFullPath($testSource)
    if (-not (Test-Path -LiteralPath $testSource -PathType Leaf)) {
      throw "The requested installer update source does not exist: $testSource"
    }
    Copy-Item -LiteralPath $testSource -Destination $candidatePath -Force
  } else {
    [Net.ServicePointManager]::SecurityProtocol =
      [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $headers = @{
      "Accept" = "application/vnd.github+json"
      "User-Agent" = "ChessGo-Installer"
    }
    $response = Invoke-RestMethod -Uri $releaseApiUrl -Headers $headers -TimeoutSec 10
    $releaseSha = [string]$response.sha
    if ($releaseSha -notmatch "^[0-9a-fA-F]{40}$") {
      throw "GitHub returned an invalid release identifier."
    }
    $installerUrl = "https://raw.githubusercontent.com/irebix/chess-go/$releaseSha/install.cmd"
    Invoke-WebRequest `
      -Uri $installerUrl `
      -Headers @{ "User-Agent" = "ChessGo-Installer" } `
      -TimeoutSec 20 `
      -OutFile $candidatePath
  }

  $candidateContent = [IO.File]::ReadAllText($candidatePath, [Text.Encoding]::UTF8)
  $candidateRevisionMatch = [regex]::Match(
    $candidateContent,
    '(?m)^set "CHESSGO_INSTALLER_REVISION=([0-9]+)"\s*$'
  )
  if (-not $candidateRevisionMatch.Success) {
    Remove-Item -LiteralPath $candidatePath -Force
    exit 0
  }
  $candidateRevision = [int64]$candidateRevisionMatch.Groups[1].Value
  if ($candidateRevision -lt $currentRevision) {
    Remove-Item -LiteralPath $candidatePath -Force
    exit 0
  }
  if ($candidateRevision -eq $currentRevision -and $candidateContent -ceq $currentContent) {
    Remove-Item -LiteralPath $candidatePath -Force
    exit 0
  }
  Assert-ChessGoInstaller $candidateContent "The downloaded installer"

  if ($candidateRevision -gt $currentRevision) {
    Write-Host "A newer ChessGo installer is ready. Updating revision $currentRevision to $candidateRevision..."
  } else {
    Write-Host "An updated ChessGo installer payload is ready. Refreshing revision $currentRevision..."
  }
  exit 20
} catch {
  if (Test-Path -LiteralPath $candidatePath) {
    Remove-Item -LiteralPath $candidatePath -Force -ErrorAction SilentlyContinue
  }
  Write-Warning "ChessGo installer self-update was skipped: $($_.Exception.Message)"
  exit 0
}

:__CHESSGO_POWERSHELL__
$ErrorActionPreference = "Stop"
$installerPath = [IO.Path]::GetFullPath($env:CHESSGO_INSTALLER)
$sourceDir = Split-Path -Parent $installerPath
$pluginId = "com.linkdesks.chess-archive-psd-generator"
$pluginFolderName = "ChessGo"
$requiredFiles = @("manifest.json", "Holopix.json", "GptImage2.json", "ImageEditor.json", "ImageRefiner.json", "ImageRefinerStyle.png", "index.html", "main.js", "main.js.LICENSE.txt", "styles.css")
$repositoryUrl = "https://github.com/irebix/chess-go.git"
$releaseBranch = "release"
$releaseApiUrl = "https://api.github.com/repos/irebix/chess-go/commits/$releaseBranch"
$releaseArchiveBaseUrl = "https://codeload.github.com/irebix/chess-go/zip"
$managedRoot = Join-Path $env:LOCALAPPDATA "ChessGo"
$managedReleaseDir = Join-Path $managedRoot "release"
$archiveReleaseDir = Join-Path $managedRoot "archive-release"
$releaseShaMarkerName = ".chessgo-release-sha"

function Show-Message([string]$text, [string]$title, [System.Windows.Forms.MessageBoxIcon]$icon) {
  [System.Windows.Forms.MessageBox]::Show(
    $text,
    $title,
    [System.Windows.Forms.MessageBoxButtons]::OK,
    $icon
  ) | Out-Null
}

function Find-Git {
  $command = Get-Command git.exe -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $candidates = @(
    (Join-Path $env:ProgramFiles "Git\cmd\git.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Git\cmd\git.exe")
  )
  if (${env:ProgramFiles(x86)}) {
    $candidates += Join-Path ${env:ProgramFiles(x86)} "Git\cmd\git.exe"
  }
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      return $candidate
    }
  }
  return $null
}

function Enable-UxpDeveloperMode([string]$settingsPath) {
  $settings = [pscustomobject]@{}
  if (Test-Path -LiteralPath $settingsPath -PathType Leaf) {
    try {
      $rawSettings = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8
      if (-not [string]::IsNullOrWhiteSpace($rawSettings)) {
        $settings = $rawSettings | ConvertFrom-Json
        if ($settings -isnot [pscustomobject]) {
          throw "Adobe developer settings must contain a JSON object."
        }
      }
    } catch {
      $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
      $backupPath = "$settingsPath.backup-$timestamp"
      Copy-Item -LiteralPath $settingsPath -Destination $backupPath -Force
      Write-Host "Invalid Adobe developer settings were backed up to: $backupPath"
      $settings = [pscustomobject]@{}
    }
  }

  $settings | Add-Member -NotePropertyName "developer" -NotePropertyValue $true -Force
  $json = $settings | ConvertTo-Json -Depth 20 -Compress
  [IO.File]::WriteAllText($settingsPath, $json, [Text.UTF8Encoding]::new($false))
}

function Test-ChessGoRelease([string]$folder) {
  if (-not $folder -or -not (Test-Path -LiteralPath $folder -PathType Container)) {
    return $false
  }
  foreach ($fileName in $requiredFiles) {
    if (-not (Test-Path -LiteralPath (Join-Path $folder $fileName) -PathType Leaf)) {
      return $false
    }
  }
  try {
    $candidateManifest = Get-Content -LiteralPath (Join-Path $folder "manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
    return $candidateManifest.id -eq $pluginId
  } catch {
    return $false
  }
}

function Assert-PathInside([string]$path, [string]$root, [string]$label) {
  $fullPath = [IO.Path]::GetFullPath($path).TrimEnd("\")
  $fullRoot = [IO.Path]::GetFullPath($root).TrimEnd("\")
  $rootPrefix = "$fullRoot\"
  if (-not $fullPath.StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw "$label is outside the expected folder: $fullPath"
  }
  return $fullPath
}

function Remove-SafeDirectory([string]$path, [string]$root) {
  if (-not (Test-Path -LiteralPath $path)) {
    return
  }
  $safePath = Assert-PathInside $path $root "Cleanup path"
  Remove-Item -LiteralPath $safePath -Recurse -Force
}

function Get-RemoteReleaseSha {
  try {
    [Net.ServicePointManager]::SecurityProtocol =
      [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $headers = @{
      "Accept" = "application/vnd.github+json"
      "User-Agent" = "ChessGo-Installer"
    }
    $response = Invoke-RestMethod -Uri $releaseApiUrl -Headers $headers -TimeoutSec 12
    $sha = [string]$response.sha
    if ($sha -notmatch "^[0-9a-fA-F]{40}$") {
      throw "GitHub returned an invalid release identifier."
    }
    return $sha.ToLowerInvariant()
  } catch {
    Write-Warning "The remote release version could not be checked: $($_.Exception.Message)"
    return $null
  }
}

function Get-GitReleaseSha([string]$folder, [string]$gitPath) {
  if (-not (Test-Path -LiteralPath (Join-Path $folder ".git"))) {
    return $null
  }
  try {
    $sha = (& $gitPath -C $folder rev-parse HEAD 2>$null | Select-Object -First 1).Trim()
    if ($LASTEXITCODE -eq 0 -and $sha -match "^[0-9a-fA-F]{40}$") {
      return $sha.ToLowerInvariant()
    }
  } catch {
  }
  return $null
}

function Get-ArchiveReleaseSha([string]$folder) {
  $marker = Join-Path $folder $releaseShaMarkerName
  if (-not (Test-Path -LiteralPath $marker -PathType Leaf)) {
    return $null
  }
  try {
    $sha = (Get-Content -LiteralPath $marker -Raw -Encoding ASCII).Trim()
    if ($sha -match "^[0-9a-fA-F]{40}$") {
      return $sha.ToLowerInvariant()
    }
  } catch {
  }
  return $null
}

function Test-ReleaseAtSha([string]$folder, [string]$sha, [string]$gitPath) {
  if (-not $sha -or -not (Test-ChessGoRelease $folder)) {
    return $false
  }
  $localSha = if (Test-Path -LiteralPath (Join-Path $folder ".git")) {
    Get-GitReleaseSha $folder $gitPath
  } else {
    Get-ArchiveReleaseSha $folder
  }
  return $localSha -eq $sha
}

function Invoke-GitPull([string]$folder, [string]$gitPath) {
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & $gitPath -C $folder pull --ff-only origin $releaseBranch 2>&1 | Out-Host
    return $LASTEXITCODE -eq 0
  } catch {
    Write-Host $_.Exception.Message
    return $false
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
}

function Invoke-GitClone([string]$folder, [string]$gitPath) {
  $previousErrorActionPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    & $gitPath clone --branch $releaseBranch --single-branch $repositoryUrl $folder 2>&1 | Out-Host
    return $LASTEXITCODE -eq 0
  } catch {
    Write-Host $_.Exception.Message
    return $false
  } finally {
    $ErrorActionPreference = $previousErrorActionPreference
  }
}

function Install-ReleaseArchive([string]$targetFolder, [string]$releaseSha, [string]$gitPath) {
  if ($releaseSha -notmatch "^[0-9a-fA-F]{40}$") {
    throw "A valid release identifier is required for archive download."
  }

  $safeTarget = Assert-PathInside $targetFolder $managedRoot "Archive release folder"
  $tempRoot = Join-Path $env:TEMP ("ChessGo-" + [Guid]::NewGuid().ToString("N"))
  $safeTempRoot = Assert-PathInside $tempRoot $env:TEMP "Temporary download folder"
  $zipPath = Join-Path $safeTempRoot "release.zip"
  $extractPath = Join-Path $safeTempRoot "expanded"
  $backupPath = $null

  try {
    New-Item -ItemType Directory -Path $extractPath -Force | Out-Null
    $archiveUrl = "$releaseArchiveBaseUrl/$releaseSha"
    Write-Host "Downloading the ChessGo release archive..."
    Invoke-WebRequest `
      -Uri $archiveUrl `
      -Headers @{ "User-Agent" = "ChessGo-Installer" } `
      -UseBasicParsing `
      -TimeoutSec 90 `
      -OutFile $zipPath
    Expand-Archive -LiteralPath $zipPath -DestinationPath $extractPath -Force

    $candidate = Get-ChildItem -LiteralPath $extractPath -Directory |
      Where-Object { Test-ChessGoRelease $_.FullName } |
      Select-Object -First 1
    if (-not $candidate) {
      throw "The downloaded ChessGo release archive is incomplete or invalid."
    }

    [IO.File]::WriteAllText(
      (Join-Path $candidate.FullName $releaseShaMarkerName),
      $releaseSha.ToLowerInvariant(),
      [Text.Encoding]::ASCII
    )

    New-Item -ItemType Directory -Path $managedRoot -Force | Out-Null
    if (Test-Path -LiteralPath $safeTarget) {
      $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
      $backupPath = Assert-PathInside "$safeTarget.backup-$timestamp" $managedRoot "Archive backup folder"
      Move-Item -LiteralPath $safeTarget -Destination $backupPath
    }

    try {
      Move-Item -LiteralPath $candidate.FullName -Destination $safeTarget
      if (-not (Test-ReleaseAtSha $safeTarget $releaseSha $gitPath)) {
        throw "The downloaded ChessGo release could not be verified."
      }
    } catch {
      if (Test-Path -LiteralPath $safeTarget) {
        Remove-SafeDirectory $safeTarget $managedRoot
      }
      if ($backupPath -and (Test-Path -LiteralPath $backupPath) -and -not (Test-Path -LiteralPath $safeTarget)) {
        Move-Item -LiteralPath $backupPath -Destination $safeTarget
      }
      throw
    }
    Write-Host "Release archive installed successfully."
    return $safeTarget
  } finally {
    Remove-SafeDirectory $safeTempRoot $env:TEMP
  }
}

function Resolve-GitBackedRelease(
  [string]$folder,
  [string]$gitPath,
  [string]$remoteSha,
  [string]$updateMessage
) {
  $localSha = Get-GitReleaseSha $folder $gitPath
  if ($remoteSha -and $localSha -eq $remoteSha -and (Test-ChessGoRelease $folder)) {
    Write-Host "ChessGo is already up to date."
    return $folder
  }
  if ($remoteSha -and (Test-ReleaseAtSha $archiveReleaseDir $remoteSha $gitPath)) {
    Write-Host "Using the current downloaded ChessGo release."
    return $archiveReleaseDir
  }

  Write-Host $updateMessage
  if (Invoke-GitPull $folder $gitPath) {
    return $folder
  }
  if ($remoteSha) {
    Write-Warning "Git update is unavailable. Switching to the GitHub release archive."
    return Install-ReleaseArchive $archiveReleaseDir $remoteSha $gitPath
  }

  Write-Warning "Git update failed and the remote version could not be checked. The local plugin files will be installed."
  return $folder
}

function Resolve-ChessGoRelease(
  [string]$initialSourceDir,
  [string]$gitPath,
  [string]$remoteSha
) {
  $scriptIsInRelease =
    (Test-Path -LiteralPath (Join-Path $initialSourceDir ".git")) -and
    (Test-ChessGoRelease $initialSourceDir)
  if ($scriptIsInRelease) {
    return Resolve-GitBackedRelease `
      $initialSourceDir `
      $gitPath `
      $remoteSha `
      "Updating the current ChessGo release folder..."
  }

  $managedGit = Join-Path $managedReleaseDir ".git"
  if (Test-Path -LiteralPath $managedGit) {
    return Resolve-GitBackedRelease `
      $managedReleaseDir `
      $gitPath `
      $remoteSha `
      "Updating ChessGo in: $managedReleaseDir"
  }
  if ($remoteSha -and (Test-ReleaseAtSha $archiveReleaseDir $remoteSha $gitPath)) {
    Write-Host "Using the current downloaded ChessGo release."
    return $archiveReleaseDir
  }

  if (Test-Path -LiteralPath $managedReleaseDir) {
    $safeManagedRelease = Assert-PathInside $managedReleaseDir $managedRoot "Managed release folder"
    $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
    $managedBackup = Assert-PathInside "$safeManagedRelease.backup-$timestamp" $managedRoot "Managed backup folder"
    Move-Item -LiteralPath $safeManagedRelease -Destination $managedBackup
    Write-Host "Existing non-Git folder backed up to: $managedBackup"
  }

  New-Item -ItemType Directory -Path $managedRoot -Force | Out-Null
  Write-Host "Cloning the ChessGo release branch..."
  if (Invoke-GitClone $managedReleaseDir $gitPath) {
    return $managedReleaseDir
  }
  if ($remoteSha) {
    Write-Warning "Git clone is unavailable. Switching to the GitHub release archive."
    return Install-ReleaseArchive $archiveReleaseDir $remoteSha $gitPath
  }
  throw "Git clone failed and the release archive version could not be checked."
}

function Read-UxpPluginRegistry([string]$registryPath) {
  if (-not (Test-Path -LiteralPath $registryPath -PathType Leaf)) {
    return [pscustomobject]@{ plugins = @() }
  }

  try {
    $rawRegistry = Get-Content -LiteralPath $registryPath -Raw -Encoding UTF8
    if ([string]::IsNullOrWhiteSpace($rawRegistry)) {
      throw "The registry file is empty."
    }
    $registry = $rawRegistry | ConvertFrom-Json
  } catch {
    throw "Adobe UXP plugin registry is invalid: $registryPath. $($_.Exception.Message)"
  }

  if ($registry -isnot [pscustomobject]) {
    throw "Adobe UXP plugin registry must contain a JSON object: $registryPath"
  }
  if (-not $registry.PSObject.Properties["plugins"]) {
    $registry | Add-Member -NotePropertyName "plugins" -NotePropertyValue @()
  } elseif ($null -eq $registry.plugins) {
    $registry.plugins = @()
  } elseif ($registry.plugins -is [string]) {
    throw "Adobe UXP plugin registry contains an invalid plugins field: $registryPath"
  }
  return $registry
}

function Install-RegisteredUxpPlugin(
  [string]$releaseFolder,
  [pscustomobject]$manifest,
  [string]$photoshopRoot
) {
  $version = [string]$manifest.version
  $minimumHostVersion = [string]$manifest.host.minVersion
  if ($pluginId -notmatch "^[A-Za-z0-9][A-Za-z0-9._-]*$") {
    throw "The plugin id cannot be used as an installation folder name: $pluginId"
  }
  if ($version -notmatch "^[0-9A-Za-z][0-9A-Za-z._-]*$") {
    throw "The plugin version cannot be used as an installation folder name: $version"
  }
  if ([string]::IsNullOrWhiteSpace($minimumHostVersion)) {
    throw "The plugin manifest does not declare a Photoshop minimum version."
  }

  $uxpRoot = Join-Path $env:APPDATA "Adobe\UXP"
  $externalRoot = Join-Path $uxpRoot "Plugins\External"
  $registryDir = Join-Path $uxpRoot "PluginsInfo\v1"
  $registryPath = Join-Path $registryDir "PS.json"
  $versionFolderName = "${pluginId}_$version"
  $destination = Join-Path $externalRoot $versionFolderName
  $staging = Join-Path $externalRoot (".$versionFolderName.installing-" + [Guid]::NewGuid().ToString("N"))
  $backupRoot = Join-Path $managedRoot "Backups\UxpPlugins"

  New-Item -ItemType Directory -Path $externalRoot -Force | Out-Null
  New-Item -ItemType Directory -Path $registryDir -Force | Out-Null
  New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
  $safeDestination = Assert-PathInside $destination $externalRoot "UXP plugin destination"
  $safeStaging = Assert-PathInside $staging $externalRoot "UXP plugin staging folder"

  $registryExisted = Test-Path -LiteralPath $registryPath -PathType Leaf
  $registry = Read-UxpPluginRegistry $registryPath
  $otherPlugins = @(
    $registry.plugins | Where-Object { [string]$_.pluginId -ne $pluginId }
  )
  $registryEntry = [pscustomobject][ordered]@{
    hostMinVersion = $minimumHostVersion
    name = [string]$manifest.name
    path = '$localPlugins\External\' + $versionFolderName
    pluginId = $pluginId
    status = "enabled"
    type = "uxp"
    versionString = $version
  }
  $registry.plugins = @($otherPlugins) + @($registryEntry)

  $destinationBackup = $null
  $registryBackup = $null
  $registryTemp = Join-Path $registryDir ("PS.json.chessgo-" + [Guid]::NewGuid().ToString("N") + ".tmp")
  try {
    New-Item -ItemType Directory -Path $safeStaging -Force | Out-Null
    foreach ($fileName in $requiredFiles) {
      $sourceFile = Join-Path $releaseFolder $fileName
      $stagedFile = Join-Path $safeStaging $fileName
      Copy-Item -LiteralPath $sourceFile -Destination $stagedFile -Force
      $sourceHash = (Get-FileHash -LiteralPath $sourceFile -Algorithm SHA256).Hash
      $stagedHash = (Get-FileHash -LiteralPath $stagedFile -Algorithm SHA256).Hash
      if ($sourceHash -ne $stagedHash) {
        throw "Plugin file verification failed: $fileName"
      }
    }

    $stagedManifest = Get-Content -LiteralPath (Join-Path $safeStaging "manifest.json") -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($stagedManifest.id -ne $pluginId -or [string]$stagedManifest.version -ne $version) {
      throw "The staged plugin manifest does not match the requested plugin version."
    }

    if (Test-Path -LiteralPath $safeDestination) {
      $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
      $destinationBackup = Join-Path $backupRoot ("$versionFolderName-$timestamp-" + [Guid]::NewGuid().ToString("N"))
      $destinationBackup = Assert-PathInside $destinationBackup $backupRoot "UXP plugin backup folder"
      Move-Item -LiteralPath $safeDestination -Destination $destinationBackup
    }
    Move-Item -LiteralPath $safeStaging -Destination $safeDestination

    $registryJson = $registry | ConvertTo-Json -Depth 100 -Compress
    [IO.File]::WriteAllText($registryTemp, $registryJson, [Text.UTF8Encoding]::new($false))
    if ($registryExisted) {
      $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
      $registryBackup = Join-Path $registryDir ("PS.json.chessgo-backup-$timestamp-" + [Guid]::NewGuid().ToString("N"))
      [IO.File]::Replace($registryTemp, $registryPath, $registryBackup, $true)
    } else {
      Move-Item -LiteralPath $registryTemp -Destination $registryPath
    }
  } catch {
    if (Test-Path -LiteralPath $safeStaging) {
      Remove-SafeDirectory $safeStaging $externalRoot
    }
    if (Test-Path -LiteralPath $safeDestination) {
      Remove-SafeDirectory $safeDestination $externalRoot
    }
    if ($destinationBackup -and (Test-Path -LiteralPath $destinationBackup)) {
      Move-Item -LiteralPath $destinationBackup -Destination $safeDestination
    }
    if (Test-Path -LiteralPath $registryTemp -PathType Leaf) {
      Remove-Item -LiteralPath $registryTemp -Force
    }
    if ($registryBackup -and (Test-Path -LiteralPath $registryBackup -PathType Leaf)) {
      Copy-Item -LiteralPath $registryBackup -Destination $registryPath -Force
    } elseif (-not $registryExisted -and (Test-Path -LiteralPath $registryPath -PathType Leaf)) {
      Remove-Item -LiteralPath $registryPath -Force
    }
    throw
  }

  $registryCheck = Read-UxpPluginRegistry $registryPath
  $registered = @(
    $registryCheck.plugins | Where-Object {
      [string]$_.pluginId -eq $pluginId -and
      [string]$_.versionString -eq $version -and
      [string]$_.path -eq ('$localPlugins\External\' + $versionFolderName) -and
      [string]$_.status -eq "enabled"
    }
  )
  if ($registered.Count -ne 1) {
    throw "Photoshop UXP plugin registration verification failed."
  }

  $legacyDestination = Join-Path (Join-Path $photoshopRoot "Plug-ins") $pluginFolderName
  if (Test-Path -LiteralPath $legacyDestination) {
    $legacyItem = Get-Item -LiteralPath $legacyDestination -Force
    $isReparsePoint = ($legacyItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
    if ($isReparsePoint) {
      [IO.Directory]::Delete($legacyDestination)
      Write-Host "Removed the legacy Photoshop Plug-ins link."
    } else {
      $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
      $legacyBackup = Join-Path $backupRoot ("Legacy-$pluginFolderName-$timestamp")
      $legacyBackup = Assert-PathInside $legacyBackup $backupRoot "Legacy plugin backup folder"
      Move-Item -LiteralPath $legacyDestination -Destination $legacyBackup
      Write-Host "Legacy Photoshop Plug-ins folder backed up to: $legacyBackup"
    }
  }

  $obsoleteFolders = @(
    Get-ChildItem -LiteralPath $externalRoot -Directory -Force -ErrorAction SilentlyContinue |
      Where-Object {
        $_.Name.StartsWith("${pluginId}_", [StringComparison]::OrdinalIgnoreCase) -and
        -not $_.FullName.Equals($safeDestination, [StringComparison]::OrdinalIgnoreCase)
      }
  )
  foreach ($obsoleteFolder in $obsoleteFolders) {
    try {
      $obsoleteManifestPath = Join-Path $obsoleteFolder.FullName "manifest.json"
      if (-not (Test-Path -LiteralPath $obsoleteManifestPath -PathType Leaf)) {
        continue
      }
      $obsoleteManifest = Get-Content -LiteralPath $obsoleteManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
      if ([string]$obsoleteManifest.id -ne $pluginId) {
        continue
      }
      $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
      $obsoleteBackup = Join-Path $backupRoot ("$($obsoleteFolder.Name)-obsolete-$timestamp-" + [Guid]::NewGuid().ToString("N"))
      $obsoleteBackup = Assert-PathInside $obsoleteBackup $backupRoot "Obsolete plugin backup folder"
      Move-Item -LiteralPath $obsoleteFolder.FullName -Destination $obsoleteBackup
      Write-Host "Previous registered plugin version backed up to: $obsoleteBackup"
    } catch {
      Write-Warning "An obsolete ChessGo plugin folder could not be archived: $($_.Exception.Message)"
    }
  }

  return [pscustomobject]@{
    Destination = $safeDestination
    RegistryPath = $registryPath
    Version = $version
  }
}

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host "Requesting administrator permission..."
  $arguments = @("/d", "/c", ('"{0}"' -f $installerPath))
  Start-Process -FilePath $env:ComSpec -ArgumentList $arguments -Verb RunAs | Out-Null
  exit 0
}

Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.Application]::EnableVisualStyles()
$host.UI.RawUI.WindowTitle = "ChessGo Installer"

try {
  Write-Host "ChessGo Installer"
  Write-Host "================="
  Write-Host ""

  $gitPath = Find-Git
  if (-not $gitPath) {
    Write-Host "Git was not found. Installing Git automatically..."
    $wingetCommand = Get-Command winget.exe -ErrorAction SilentlyContinue
    $wingetPath = if ($wingetCommand) { $wingetCommand.Source } else { Join-Path $env:LOCALAPPDATA "Microsoft\WindowsApps\winget.exe" }
    if (-not (Test-Path -LiteralPath $wingetPath -PathType Leaf)) {
      throw "Git is required, and Windows Package Manager is not available to install it automatically."
    }
    & $wingetPath install --id Git.Git -e --source winget --accept-source-agreements --accept-package-agreements --silent
    if ($LASTEXITCODE -ne 0) {
      throw "Git installation failed with exit code $LASTEXITCODE."
    }
    $gitPath = Find-Git
    if (-not $gitPath) {
      throw "Git was installed but git.exe could not be located. Restart Windows and run this installer again."
    }
    Write-Host "Git installed successfully."
    Write-Host ""
  }

  $remoteReleaseSha = Get-RemoteReleaseSha
  if ($remoteReleaseSha) {
    Write-Host "Remote release: $($remoteReleaseSha.Substring(0, 7))"
  }
  $sourceDir = Resolve-ChessGoRelease $sourceDir $gitPath $remoteReleaseSha
  Write-Host ""

  if (-not (Test-ChessGoRelease $sourceDir)) {
    throw "The ChessGo release folder is incomplete or invalid: $sourceDir"
  }

  $manifestPath = Join-Path $sourceDir "manifest.json"
  $manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($manifest.id -ne $pluginId) {
    throw "The selected release folder contains an unexpected plugin manifest."
  }

  $dialog = [System.Windows.Forms.FolderBrowserDialog]::new()
  $dialog.Description = "Select the Adobe Photoshop installation folder that contains Photoshop.exe."
  $dialog.ShowNewFolderButton = $false

  $appPathKey = "Registry::HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\Photoshop.exe"
  $appPath = $null
  if (Test-Path -LiteralPath $appPathKey) {
    $appPath = (Get-ItemProperty -LiteralPath $appPathKey -ErrorAction SilentlyContinue)."(default)"
  }
  if ($appPath -and (Test-Path -LiteralPath $appPath -PathType Leaf)) {
    $dialog.SelectedPath = Split-Path -Parent $appPath
  } elseif (Test-Path -LiteralPath "$env:ProgramFiles\Adobe") {
    $dialog.SelectedPath = "$env:ProgramFiles\Adobe"
  }

  $selection = $dialog.ShowDialog()
  $photoshopRoot = $dialog.SelectedPath
  $dialog.Dispose()
  if ($selection -ne [System.Windows.Forms.DialogResult]::OK) {
    Write-Host "Installation cancelled."
    exit 2
  }

  $photoshopRoot = [IO.Path]::GetFullPath($photoshopRoot)
  $photoshopExe = Join-Path $photoshopRoot "Photoshop.exe"
  if (-not (Test-Path -LiteralPath $photoshopExe -PathType Leaf)) {
    throw "Photoshop.exe was not found in the selected folder."
  }

  $versionText = (Get-Item -LiteralPath $photoshopExe).VersionInfo.ProductVersion
  $versionMatch = [regex]::Match([string]$versionText, "\d+(?:\.\d+){1,3}")
  if ($versionMatch.Success) {
    $photoshopVersion = [version]$versionMatch.Value
    $minimumVersion = [version]$manifest.host.minVersion
    if ($photoshopVersion -lt $minimumVersion) {
      throw "This plugin requires Photoshop $minimumVersion or newer. Selected version: $photoshopVersion."
    }
  }

  Write-Host "Selected Photoshop: $photoshopRoot"
  Write-Host "Enabling Adobe UXP developer mode..."
  $developerDir = Join-Path $env:CommonProgramFiles "Adobe\UXP\Developer"
  $developerSettings = Join-Path $developerDir "settings.json"
  New-Item -ItemType Directory -Path $developerDir -Force | Out-Null
  Enable-UxpDeveloperMode $developerSettings

  Write-Host "Registering ChessGo with the Photoshop UXP plugin manager..."
  $installation = Install-RegisteredUxpPlugin $sourceDir $manifest $photoshopRoot

  $photoshopIsRunning = @(Get-Process -Name Photoshop -ErrorAction SilentlyContinue).Count -gt 0
  $result = "ChessGo $($installation.Version) was installed successfully.`r`n`r`nPlugin folder: $($installation.Destination)`r`nRegistration: $($installation.RegistryPath)`r`n`r`n"
  if ($photoshopIsRunning) {
    $result += "Restart Photoshop once to load the registered plugin. No other setup is required."
  } else {
    $result += "Start Photoshop normally to load the registered plugin. No other setup is required."
  }

  Write-Host ""
  Write-Host $result
  Show-Message $result "ChessGo Installer" ([System.Windows.Forms.MessageBoxIcon]::Information)
  exit 0
} catch {
  $message = "Installation failed.`r`n`r`n$($_.Exception.Message)"
  Write-Host ""
  Write-Error $_
  Show-Message $message "ChessGo Installer" ([System.Windows.Forms.MessageBoxIcon]::Error)
  exit 1
}
