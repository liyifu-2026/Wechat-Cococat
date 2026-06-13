# CocoCat stack control (Windows)
param(
  [Parameter(Position = 0)][string]$Action = "status",
  [Parameter(Position = 1)][string]$Service = "all"
)

$ErrorActionPreference = "Stop"
$RepoRoot = if ($env:COCOCAT_REPO_ROOT) { $env:COCOCAT_REPO_ROOT } else { Split-Path $PSScriptRoot -Parent }
$CococatConfig = if ($env:COCOCAT_CONFIG_DIR) { $env:COCOCAT_CONFIG_DIR } else { Join-Path $env:USERPROFILE ".config\cococat" }
$CococatData = if ($env:COCOCAT_DATA_DIR) { $env:COCOCAT_DATA_DIR } else { Join-Path $env:USERPROFILE ".local\share\cococat" }
$StackDir = Join-Path $CococatData "stack"
New-Item -ItemType Directory -Force -Path $StackDir | Out-Null

function Read-Token {
  foreach ($p in @(
    (Join-Path $CococatConfig "token")
  )) {
    if (Test-Path $p) { return (Get-Content $p -Raw).Trim() }
  }
  return $null
}

function Test-Driver {
  try {
    Invoke-RestMethod -Uri "http://127.0.0.1:6174/api/status" -TimeoutSec 3 | Out-Null
    Write-Output "driver: up (http://127.0.0.1:6174)"
    return $true
  } catch {
    Write-Output "driver: down"
    return $false
  }
}

function Test-Memory {
  try {
    Invoke-RestMethod -Uri "http://127.0.0.1:8420/health" -TimeoutSec 3 | Out-Null
    Write-Output "memory: up (http://127.0.0.1:8420)"
    return $true
  } catch {
    Write-Output "memory: down"
    return $false
  }
}

function Test-Agent {
  $pidFile = Join-Path $StackDir "agent.pid"
  if (Test-Path $pidFile) {
    $procId = Get-Content $pidFile -Raw
    if (Get-Process -Id $procId -ErrorAction SilentlyContinue) {
      Write-Output "agent: up pid=$procId"
      return $true
    }
  }
  Write-Output "agent: down"
  return $false
}

function Start-Driver {
  if (Test-Driver) { return }
  $tokenPath = Join-Path $CococatConfig "token"
  if (-not (Test-Path $tokenPath)) {
    New-Item -ItemType Directory -Force -Path $CococatConfig | Out-Null
    $token = -join ((1..32 | ForEach-Object { '{0:x2}' -f (Get-Random -Maximum 256) }))
    $token | Set-Content $tokenPath -NoNewline
  }
  $env:AGENT_WECHAT_DATA_ROOT = $CococatData
  $env:COCOCAT_CONFIG_DIR = $CococatConfig
  Push-Location $RepoRoot
  docker compose up -d
  Pop-Location
  Start-Sleep -Seconds 2
  Test-Driver | Out-Null
}

function Stop-Driver {
  Push-Location $RepoRoot
  docker compose down 2>$null
  Pop-Location
  Write-Output "driver: stopped"
}

function Start-Agent {
  if (Test-Agent) { return }
  if (-not (Test-Driver)) {
    Write-Error "agent: driver not up"
    return
  }
  $token = Read-Token
  if (-not $token) { Write-Error "agent: missing token"; return }
  $env:COCOCAT_CONFIG_DIR = $CococatConfig
  $env:COCOCAT_DATA_DIR = $CococatData
  $env:AGENT_WECHAT_TOKEN = $token
  $log = Join-Path $StackDir "agent.log"
  Push-Location $RepoRoot
  if (-not (Test-Path "packages\agent\dist")) {
    pnpm agent:build
  }
  $proc = Start-Process -FilePath "pnpm" -ArgumentList "agent" -PassThru -RedirectStandardOutput $log -RedirectStandardError $log -WindowStyle Hidden
  $proc.Id | Set-Content (Join-Path $StackDir "agent.pid")
  Pop-Location
  Start-Sleep -Seconds 2
  Test-Agent | Out-Null
}

function Stop-Agent {
  $pidFile = Join-Path $StackDir "agent.pid"
  if (Test-Path $pidFile) {
    $procId = [int](Get-Content $pidFile -Raw)
    Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
    Write-Output "agent: stopped"
  } else {
    Write-Output "agent: not running"
  }
}

function Invoke-MemoryScript {
  param([string]$MemAction)
  $bash = Get-Command bash -ErrorAction SilentlyContinue
  if ($bash) {
    & bash (Join-Path $RepoRoot "scripts/start-tencentdb-gateway.sh") $MemAction
  } else {
    Write-Output "memory: install Git Bash or start gateway manually"
  }
}

function Invoke-Target {
  param([string]$Op, [string]$Name)
  switch ($Name) {
    "driver" {
      if ($Op -eq "start") { Start-Driver }
      elseif ($Op -eq "stop") { Stop-Driver }
      else { Test-Driver | Out-Null }
    }
    "memory" {
      if ($Op -eq "start") { Invoke-MemoryScript "" }
      elseif ($Op -eq "stop") { Invoke-MemoryScript "stop" }
      else { Test-Memory | Out-Null }
    }
    "agent" {
      if ($Op -eq "start") { Start-Agent }
      elseif ($Op -eq "stop") { Stop-Agent }
      else { Test-Agent | Out-Null }
    }
    "all" {
      if ($Op -eq "start") { Start-Driver; Invoke-MemoryScript ""; Start-Agent }
      elseif ($Op -eq "stop") { Stop-Agent; Invoke-MemoryScript "stop"; Stop-Driver }
      else { Test-Driver | Out-Null; Test-Memory | Out-Null; Test-Agent | Out-Null }
    }
    default { Write-Error "unknown service: $Name" }
  }
}

Invoke-Target -Op $Action -Name $Service
