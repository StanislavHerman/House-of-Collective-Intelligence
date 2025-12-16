$ErrorActionPreference = "Stop"

Write-Host "🏠 House of Collective Intelligence - Windows Installer" -ForegroundColor Cyan

# 1. Check Node.js
try {
    $nodeVersion = node -v
    Write-Host "✓ Node.js found: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "❌ Node.js not found. Please install Node.js (LTS recommended) from https://nodejs.org/" -ForegroundColor Red
    exit 1
}

# 2. Install Dependencies
Write-Host "`n📦 Installing dependencies..." -ForegroundColor Yellow
npm install
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ npm install failed" -ForegroundColor Red
    exit 1
}

# 3. Build Project
Write-Host "`n🔨 Building project..." -ForegroundColor Yellow
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "❌ Build failed" -ForegroundColor Red
    exit 1
}

# 4. Create Launch Scripts
Write-Host "`n🚀 Setting up 'hause' command..." -ForegroundColor Yellow

$currentDir = Get-Location
$batchPath = Join-Path $currentDir "hause.cmd"
$psPath = Join-Path $currentDir "hause.ps1"
$jsPath = Join-Path $currentDir "dist\index.js"

# Create .cmd script for Command Prompt
$cmdContent = "@echo off`r`nnode `"$jsPath`" %*"
Set-Content -Path $batchPath -Value $cmdContent
Write-Host "  Created $batchPath" -ForegroundColor Gray

# Create .ps1 script for PowerShell
$psContent = "node `"$jsPath`" `$args"
Set-Content -Path $psPath -Value $psContent
Write-Host "  Created $psPath" -ForegroundColor Gray

Write-Host "`n✅ Installation Complete!" -ForegroundColor Green
Write-Host "To run the agent, use:" -ForegroundColor Cyan
Write-Host "  .\hause.cmd" -ForegroundColor White
Write-Host "  or add this folder to your PATH." -ForegroundColor Gray
