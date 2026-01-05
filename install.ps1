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
if (Test-Path "package-lock.json") {
    npm ci
} else {
    npm install
}
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

# 4. Register `hause` command in user PATH (no admin)
Write-Host "`n🚀 Registering 'hause' command..." -ForegroundColor Yellow

$rootDir = (Get-Location).Path
$jsPath = Join-Path $rootDir "dist\index.js"
$binDir = Join-Path $env:USERPROFILE ".local\bin"
New-Item -ItemType Directory -Force -Path $binDir | Out-Null

$hauseCmd = Join-Path $binDir "hause.cmd"
$councilCmd = Join-Path $binDir "council.cmd"
$cmdContent = "@echo off`r`nnode `"$jsPath`" %*"
Set-Content -Path $hauseCmd -Value $cmdContent -Encoding ASCII
Set-Content -Path $councilCmd -Value $cmdContent -Encoding ASCII
Write-Host "  Created $hauseCmd" -ForegroundColor Gray

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ([string]::IsNullOrWhiteSpace($userPath)) { $userPath = "" }
$parts = $userPath.Split(';') | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
if (-not ($parts -contains $binDir)) {
    $newUserPath = if ($userPath.Length -gt 0) { "$binDir;$userPath" } else { "$binDir" }
    [Environment]::SetEnvironmentVariable("Path", $newUserPath, "User")
    $env:Path = "$binDir;$env:Path"
    Write-Host "  Added $binDir to user PATH (new terminals)." -ForegroundColor Gray
} else {
    Write-Host "  $binDir already in user PATH." -ForegroundColor Gray
}

Write-Host "`n✅ Installation Complete!" -ForegroundColor Green
Write-Host "Start a new terminal, then run:" -ForegroundColor Cyan
Write-Host "  hause" -ForegroundColor White
