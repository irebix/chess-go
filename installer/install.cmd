@echo off
setlocal EnableExtensions DisableDelayedExpansion
set "CHESSGO_INSTALLER=%~f0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$marker=':__CHESSGO_POWERSHELL__'; $raw=[IO.File]::ReadAllText($env:CHESSGO_INSTALLER); $start=$raw.LastIndexOf($marker); if($start -lt 0){throw 'Installer payload was not found.'}; Invoke-Expression $raw.Substring($start+$marker.Length)"
set "CHESSGO_EXIT=%ERRORLEVEL%"
endlocal & exit /b %CHESSGO_EXIT%

:__CHESSGO_POWERSHELL__
$ErrorActionPreference = "Stop"
$installerPath = [IO.Path]::GetFullPath($env:CHESSGO_INSTALLER)
$sourceDir = Split-Path -Parent $installerPath
$pluginId = "com.linkdesks.chess-archive-psd-generator"
$pluginFolderName = "ChessGo"
$requiredFiles = @("manifest.json", "Holopix.json", "index.html", "main.js", "main.js.LICENSE.txt", "styles.css")
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

  Write-Host "Linking the plugin into Photoshop..."
  $pluginsDir = Join-Path $photoshopRoot "Plug-ins"
  $destination = Join-Path $pluginsDir $pluginFolderName
  New-Item -ItemType Directory -Path $pluginsDir -Force | Out-Null

  $sourceFullPath = [IO.Path]::GetFullPath($sourceDir).TrimEnd("\")
  $destinationFullPath = [IO.Path]::GetFullPath($destination).TrimEnd("\")
  if (-not $sourceFullPath.Equals($destinationFullPath, [StringComparison]::OrdinalIgnoreCase)) {
    if (Test-Path -LiteralPath $destination) {
      $existing = Get-Item -LiteralPath $destination -Force
      $isReparsePoint = ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0
      if ($isReparsePoint) {
        [IO.Directory]::Delete($destination)
      } else {
        $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
        $backupRoot = Join-Path $env:ProgramData "ChessGo\Backups"
        New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
        $backup = Join-Path $backupRoot "$pluginFolderName-$timestamp"
        Move-Item -LiteralPath $destination -Destination $backup
        Write-Host "Previous plugin folder backed up to: $backup"
      }
    }
    New-Item -ItemType Junction -Path $destination -Target $sourceFullPath | Out-Null
  }

  $installedManifest = Join-Path $destination "manifest.json"
  if (-not (Test-Path -LiteralPath $installedManifest -PathType Leaf)) {
    throw "Plugin link verification failed."
  }
  $installed = Get-Content -LiteralPath $installedManifest -Raw -Encoding UTF8 | ConvertFrom-Json
  if ($installed.id -ne $pluginId) {
    throw "Installed plugin verification failed."
  }

  $photoshopIsRunning = @(Get-Process -Name Photoshop -ErrorAction SilentlyContinue).Count -gt 0
  $result = "ChessGo $($installed.version) was installed successfully.`r`n`r`nRelease folder: $sourceDir`r`n`r`n"
  if ($photoshopIsRunning) {
    $result += "Restart Photoshop once to load the plugin. No other setup is required."
  } else {
    $result += "Start Photoshop normally. No other setup is required."
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
