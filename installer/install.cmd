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

function Show-Message([string]$text, [string]$title, [System.Windows.Forms.MessageBoxIcon]$icon) {
  [System.Windows.Forms.MessageBox]::Show(
    $text,
    $title,
    [System.Windows.Forms.MessageBoxButtons]::OK,
    $icon
  ) | Out-Null
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

  $gitPath = $null
  $gitCommand = Get-Command git.exe -ErrorAction SilentlyContinue
  if ($gitCommand) {
    $gitPath = $gitCommand.Source
  } elseif (Test-Path -LiteralPath "$env:ProgramFiles\Git\cmd\git.exe") {
    $gitPath = "$env:ProgramFiles\Git\cmd\git.exe"
  }

  if ($gitPath -and (Test-Path -LiteralPath (Join-Path $sourceDir ".git"))) {
    Write-Host "Checking the release branch for updates..."
    & $gitPath -C $sourceDir pull --ff-only
    if ($LASTEXITCODE -ne 0) {
      Write-Warning "Git update failed. The local plugin files will be installed."
    }
    Write-Host ""
  }

  foreach ($fileName in $requiredFiles) {
    $filePath = Join-Path $sourceDir $fileName
    if (-not (Test-Path -LiteralPath $filePath -PathType Leaf)) {
      throw "Missing plugin file: $fileName. Run this installer from the ChessGo release folder."
    }
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
  [IO.File]::WriteAllText(
    $developerSettings,
    '{"developer": true}',
    [Text.UTF8Encoding]::new($false)
  )

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
        $backup = "$destination.backup-$timestamp"
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
  $result = "ChessGo $($installed.version) was installed successfully.`r`n`r`n"
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
