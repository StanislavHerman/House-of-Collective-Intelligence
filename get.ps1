$ErrorActionPreference = "Stop"

param(
  [string]$InstallDir = (Join-Path $HOME "House-of-Collective-Intelligence"),
  [switch]$Update
)

Write-Host "🏛  House of Collective Intelligence — Installer" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

$RepoUrl = "https://github.com/StanislavHerman/House-of-Collective-Intelligence.git"

function Assert-Command($name, $helpUrl) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    Write-Host "❌ $name not found. Install it first: $helpUrl" -ForegroundColor Red
    exit 1
  }
}

Assert-Command "git" "https://git-scm.com/downloads"
Assert-Command "node" "https://nodejs.org/"
Assert-Command "npm" "https://nodejs.org/"

Write-Host "✓ Node: $(node -v)" -ForegroundColor Green
Write-Host "✓ Git:  $(git --version)" -ForegroundColor Green
Write-Host ""

if (Test-Path (Join-Path $InstallDir ".git")) {
  if (-not $Update) {
    Write-Host "Directory already exists: $InstallDir" -ForegroundColor Yellow
    Write-Host "Re-run with -Update to update it instead." -ForegroundColor Yellow
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

Write-Host ""
Write-Host "Running setup..." -ForegroundColor Cyan
Set-Location $InstallDir
powershell -ExecutionPolicy Bypass -File .\install.ps1

Write-Host ""
Write-Host "Done." -ForegroundColor Green
Write-Host "Start a new terminal, then run: hause" -ForegroundColor Cyan

