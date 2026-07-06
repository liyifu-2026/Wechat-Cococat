# CocoCat stack control (Windows)
param(
  [Parameter(Position = 0)][string]$Action = "status",
  [Parameter(Position = 1)][string]$Service = "all"
)

$ErrorActionPreference = "Stop"
$RepoRoot = if ($env:COCOCAT_REPO_ROOT) { $env:COCOCAT_REPO_ROOT } else { Split-Path $PSScriptRoot -Parent }
$RuntimeRoot = if ($env:COCOCAT_RESOURCE_ROOT) { $env:COCOCAT_RESOURCE_ROOT } else { $RepoRoot }
$IsSourceCheckout = Test-Path (Join-Path $RepoRoot "pnpm-lock.yaml")
$DefaultConfigRoot = if ($env:APPDATA) { Join-Path $env:APPDATA "CocoCat" } else { Join-Path $env:USERPROFILE ".config\cococat" }
$DefaultDataRoot = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "CocoCat" } else { Join-Path $env:USERPROFILE ".local\share\cococat" }
$CococatConfig = if ($env:COCOCAT_CONFIG_DIR) { $env:COCOCAT_CONFIG_DIR } else { $DefaultConfigRoot }
$CococatData = if ($env:COCOCAT_DATA_DIR) { $env:COCOCAT_DATA_DIR } else { $DefaultDataRoot }
$StackDir = Join-Path $CococatData "stack"
New-Item -ItemType Directory -Force -Path $StackDir | Out-Null

function Get-PnpmInvocation {
  $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
  if ($pnpm) { return @($pnpm.Source) }
  $corepack = Get-Command corepack -ErrorAction SilentlyContinue
  if ($corepack) { return @($corepack.Source, "pnpm") }
  Write-Error "pnpm/corepack not found. Run scripts\install-windows.ps1 after installing Node.js 22+."
}

function Invoke-Pnpm {
  param([string[]]$PnpmArgs)
  $cmd = @(Get-PnpmInvocation)
  $file = $cmd[0]
  $args = @()
  if ($cmd.Length -gt 1) { $args += $cmd[1..($cmd.Length - 1)] }
  $args += $PnpmArgs
  & $file @args
}

function Import-DotEnv {
  param([string]$Path)
  if (-not (Test-Path $Path)) { return }
  Get-Content $Path | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
      $key, $value = $line.Split("=", 2)
      $key = $key.Trim()
      $value = $value.Trim().Trim('"').Trim("'")
      if ($key) {
        [System.Environment]::SetEnvironmentVariable($key, $value, "Process")
      }
    }
  }
}

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
  $env:COCOCAT_DATA_DIR = $CococatData
  $env:COCOCAT_RESOURCE_ROOT = $RuntimeRoot
  Push-Location $RuntimeRoot
  docker compose up -d
  Pop-Location
  Start-Sleep -Seconds 2
  Test-Driver | Out-Null
}

function Stop-Driver {
  Push-Location $RuntimeRoot
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
  $env:COCOCAT_RESOURCE_ROOT = $RuntimeRoot
  $env:AGENT_WECHAT_DATA_ROOT = $CococatData
  $env:AGENT_WECHAT_TOKEN = $token
  Import-DotEnv (Join-Path $CococatConfig "agent.env")
  Import-DotEnv (Join-Path $CococatConfig "caption.env")
  $log = Join-Path $StackDir "agent.log"
  $errLog = Join-Path $StackDir "agent.err.log"
  Push-Location $RuntimeRoot
  if (-not (Test-Path "packages\agent\dist\cli.js") -and $IsSourceCheckout) {
    Pop-Location
    Push-Location $RepoRoot
    Invoke-Pnpm @("agent:build")
  }
  if (-not (Test-Path (Join-Path $RuntimeRoot "packages\agent\dist\cli.js"))) {
    Write-Error "agent: missing packaged build at $RuntimeRoot\packages\agent\dist\cli.js"
    return
  }
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    Write-Error "agent: node not found. Install Node.js 22+."
    return
  }
  $file = $node.Source
  $args = @((Join-Path $RuntimeRoot "packages\agent\dist\cli.js"))
  $proc = Start-Process -FilePath $file -ArgumentList $args -PassThru -RedirectStandardOutput $log -RedirectStandardError $errLog -WindowStyle Hidden
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
    $script = Join-Path $RuntimeRoot "scripts/start-tencentdb-gateway.sh"
    if (-not (Test-Path $script)) {
      $script = Join-Path $RepoRoot "scripts/start-tencentdb-gateway.sh"
    }
    & bash $script $MemAction
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
