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
$requiredFiles = @("manifest.json", "index.html", "main.js", "main.js.LICENSE.txt", "styles.css")
$repositoryUrl = "https://github.com/irebix/chess-go.git"
$releaseBranch = "release"
$managedReleaseDir = Join-Path $env:LOCALAPPDATA "ChessGo\release"

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

  $scriptIsInRelease = (Test-Path -LiteralPath (Join-Path $sourceDir ".git")) -and (Test-ChessGoRelease $sourceDir)
  if ($scriptIsInRelease) {
    Write-Host "Updating the current ChessGo release folder..."
    & $gitPath -C $sourceDir pull --ff-only origin $releaseBranch
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "Git update failed. The local plugin files will be installed."
    }
    Write-Host ""
  } else {
    $sourceDir = $managedReleaseDir
    $managedGit = Join-Path $managedReleaseDir ".git"
    if (Test-Path -LiteralPath $managedGit) {
      Write-Host "Updating ChessGo in: $managedReleaseDir"
      & $gitPath -C $managedReleaseDir pull --ff-only origin $releaseBranch
      if ($LASTEXITCODE -ne 0) {
        throw "The existing ChessGo release could not be updated."
      }
    } else {
      if (Test-Path -LiteralPath $managedReleaseDir) {
        $timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
        $managedBackup = "$managedReleaseDir.backup-$timestamp"
        Move-Item -LiteralPath $managedReleaseDir -Destination $managedBackup
        Write-Host "Existing non-Git folder backed up to: $managedBackup"
      }
      $managedParent = Split-Path -Parent $managedReleaseDir
      New-Item -ItemType Directory -Path $managedParent -Force | Out-Null
      Write-Host "Cloning the ChessGo release branch..."
      & $gitPath clone --branch $releaseBranch --single-branch $repositoryUrl $managedReleaseDir
      if ($LASTEXITCODE -ne 0) {
        throw "Git clone failed with exit code $LASTEXITCODE."
      }
    }
    Write-Host ""
  }

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
