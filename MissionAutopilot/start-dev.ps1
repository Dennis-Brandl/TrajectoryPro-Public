# start-dev.ps1 — Kill stale processes, start dev services, print browser URIs

$ErrorActionPreference = 'SilentlyContinue'
$ProjectDir = $PSScriptRoot

# ── 1. Kill old processes ──────────────────────────────────────────────
Write-Host "`n=== Cleaning up old processes ===" -ForegroundColor Cyan

$killed = 0

# Kill node/tsx processes running from this project
Get-Process -Name node, tsx 2>$null | Where-Object {
    try { $_.Path -and $_.CommandLine -match 'MissionAutopilot' } catch { $false }
} | ForEach-Object {
    Write-Host "  Killing $($_.ProcessName) (PID $($_.Id))" -ForegroundColor Yellow
    Stop-Process -Id $_.Id -Force
    $killed++
}

# Also kill by command line for node processes that don't match by name alone
Get-CimInstance Win32_Process -Filter "Name='node.exe'" 2>$null | Where-Object {
    $_.CommandLine -match 'MissionAutopilot'
} | ForEach-Object {
    if (Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue) {
        Write-Host "  Killing node.exe (PID $($_.ProcessId))" -ForegroundColor Yellow
        Stop-Process -Id $_.ProcessId -Force
        $killed++
    }
}

if ($killed -eq 0) {
    Write-Host "  No stale processes found." -ForegroundColor Green
} else {
    Write-Host "  Killed $killed process(es)." -ForegroundColor Green
    Start-Sleep -Seconds 1
}

# ── 2. Start dev services ─────────────────────────────────────────────
Write-Host "`n=== Starting Mission Autopilot ===" -ForegroundColor Cyan
Write-Host "  Working directory: $ProjectDir"
Write-Host "  Running: npm run dev`n"

# ── 3. Print browser URIs ─────────────────────────────────────────────
Write-Host "=== Open in browser ===" -ForegroundColor Cyan
Write-Host "  Management Console:       " -NoNewline
Write-Host "http://localhost:5176" -ForegroundColor Green
Write-Host "  Mission Autopilot Tester: " -NoNewline
Write-Host "http://localhost:3004" -ForegroundColor Green
Write-Host ""

# ── 4. Launch npm run dev (takes over this terminal) ──────────────────
Set-Location $ProjectDir
npm run dev
