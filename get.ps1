$ErrorActionPreference = "Stop"

param(
  [string]$InstallDir = (Join-Path $HOME "House-of-Collective-Intelligence"),
  [switch]$Update
)

Write-Host "🏛  House of Collective Intelligence — Installer" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

$RepoUrl = "https://github.com/StanislavHerman/House-of-Collective-Intelligence.git"

function Refresh-Path {
  $machine = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $user = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machine;$user"
}

function Node-MajorVersion {
  try {
    $v = (node -v).Trim()
    $v = $v.TrimStart("v")
    return [int]($v.Split(".")[0])
  } catch {
    return $null
  }
}

function Ensure-Winget {
  if (Get-Command winget -ErrorAction SilentlyContinue) { return $true }
  Write-Host "⚠ winget not found. Install 'App Installer' from Microsoft Store, or install prerequisites manually." -ForegroundColor Yellow
  return $false
}

function Ensure-Git {
  if (Get-Command git -ErrorAction SilentlyContinue) { return }

  Write-Host "Git not found. Trying to install Git..." -ForegroundColor Yellow
  if (Ensure-Winget) {
    winget install -e --id Git.Git --source winget --accept-source-agreements --accept-package-agreements
    Refresh-Path
  }

  if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    $fallback = Join-Path ${env:ProgramFiles} "Git\cmd\git.exe"
    if (Test-Path $fallback) {
      $env:Path = "$(Split-Path $fallback);$env:Path"
      return
    }
    Write-Host "⚠ Git still not available. Will install from GitHub archive (updates by re-running this installer)." -ForegroundColor Yellow
  }
}

function Ensure-Node {
  $major = Node-MajorVersion
  if ($major -ne $null -and $major -ge 18 -and (Get-Command npm -ErrorAction SilentlyContinue)) { return }

  Write-Host "Node.js v18+ not found. Trying to install Node.js (recommended: LTS)..." -ForegroundColor Yellow
  if (Ensure-Winget) {
    winget install -e --id OpenJS.NodeJS.LTS --source winget --accept-source-agreements --accept-package-agreements
    Refresh-Path
  }

  $major = Node-MajorVersion
  if ($major -eq $null -or $major -lt 18 -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
    $nodeFallback = Join-Path ${env:ProgramFiles} "nodejs\node.exe"
    if (Test-Path $nodeFallback) {
      $env:Path = "$(Split-Path $nodeFallback);$env:Path"
      $major = Node-MajorVersion
    }
  }

  if ($major -eq $null -or $major -lt 18 -or -not (Get-Command npm -ErrorAction SilentlyContinue)) {
    Write-Host "❌ Failed to install Node.js automatically. Install Node.js v18+ from https://nodejs.org/ and re-run." -ForegroundColor Red
    exit 1
  }
}

Ensure-Git
Ensure-Node

Write-Host "✓ Node: $(node -v)" -ForegroundColor Green
if (Get-Command git -ErrorAction SilentlyContinue) {
  Write-Host "✓ Git:  $(git --version)" -ForegroundColor Green
} else {
  Write-Host "⚠ Git:  not available (archive install mode)" -ForegroundColor Yellow
}
Write-Host ""

if (Get-Command git -ErrorAction SilentlyContinue) {
  if (Test-Path (Join-Path $InstallDir ".git")) {
    if (-not $Update) { $Update = $true }

    $status = (git -C $InstallDir status --porcelain)
    if (-not [string]::IsNullOrWhiteSpace($status)) {
      Write-Host "Repo has local changes: $InstallDir" -ForegroundColor Yellow
      Write-Host "Commit/stash them first, or reinstall into a different folder (-InstallDir)." -ForegroundColor Yellow
      exit 2
    }

    Write-Host "Updating existing install at: $InstallDir" -ForegroundColor Cyan
    git -C $InstallDir fetch origin --prune
    git -C $InstallDir checkout -B main origin/main
    git -C $InstallDir pull --ff-only origin main
  } else {
    if (Test-Path $InstallDir) {
      Write-Host "Path exists but is not a git repo: $InstallDir" -ForegroundColor Red
      Write-Host "Move it away or choose a different -InstallDir." -ForegroundColor Red
      exit 2
    }

    Write-Host "Cloning to: $InstallDir" -ForegroundColor Cyan
    git clone $RepoUrl $InstallDir
  }
} else {
  $ZipUrl = "https://codeload.github.com/StanislavHerman/House-of-Collective-Intelligence/zip/refs/heads/main"
  $tmpZip = Join-Path ([IO.Path]::GetTempPath()) ("hause_" + [Guid]::NewGuid().ToString() + ".zip")
  $tmpDir = Join-Path ([IO.Path]::GetTempPath()) ("hause_" + [Guid]::NewGuid().ToString())

  Write-Host "Downloading archive..." -ForegroundColor Cyan
  Invoke-WebRequest -Uri $ZipUrl -OutFile $tmpZip
  New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
  Expand-Archive -Path $tmpZip -DestinationPath $tmpDir -Force

  $extracted = Get-ChildItem -Path $tmpDir | Where-Object { $_.PSIsContainer } | Select-Object -First 1
  if (-not $extracted) {
    Write-Host "❌ Failed to extract archive." -ForegroundColor Red
    exit 1
  }

  if (Test-Path $InstallDir) {
    Write-Host "Replacing existing directory: $InstallDir" -ForegroundColor Yellow
    Remove-Item -Recurse -Force $InstallDir
  }

  Move-Item -Path $extracted.FullName -Destination $InstallDir
  Remove-Item -Force $tmpZip
  Remove-Item -Recurse -Force $tmpDir
}

Write-Host ""
Write-Host "Running setup..." -ForegroundColor Cyan
Set-Location $InstallDir
powershell -ExecutionPolicy Bypass -File .\install.ps1

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "Start a new terminal, then run: hause" -ForegroundColor Cyan
