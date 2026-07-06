# CocoCat Windows installer bootstrap.
#
# This script prepares a source or zip checkout for local Windows use. It does
# not install system dependencies automatically; it checks them and gives exact
# next steps so the install path is repeatable and debuggable.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1 -BuildImage
#   powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1 -ImageTar .\agent-wechat-amd64.tar

param(
  [string]$Image = "agent-wechat:amd64",
  [string]$ImageTar = "",
  [string]$ResourceRoot = "",
  [switch]$BuildImage,
  [switch]$SkipPnpmInstall,
  [switch]$SkipAgentBuild
)

$ErrorActionPreference = "Stop"

$RepoRoot = if ($env:COCOCAT_REPO_ROOT) {
  $env:COCOCAT_REPO_ROOT
} else {
  Split-Path $PSScriptRoot -Parent
}

$RuntimeRoot = if ($ResourceRoot) {
  $ResourceRoot
} elseif ($env:COCOCAT_RESOURCE_ROOT) {
  $env:COCOCAT_RESOURCE_ROOT
} else {
  $RepoRoot
}
$IsSourceCheckout = Test-Path (Join-Path $RepoRoot "pnpm-lock.yaml")

$DefaultConfigRoot = if ($env:APPDATA) {
  Join-Path $env:APPDATA "CocoCat"
} else {
  Join-Path $env:USERPROFILE ".config\cococat"
}

$DefaultDataRoot = if ($env:LOCALAPPDATA) {
  Join-Path $env:LOCALAPPDATA "CocoCat"
} else {
  Join-Path $env:USERPROFILE ".local\share\cococat"
}

$CococatConfig = if ($env:COCOCAT_CONFIG_DIR) {
  $env:COCOCAT_CONFIG_DIR
} else {
  $DefaultConfigRoot
}

$CococatData = if ($env:COCOCAT_DATA_DIR) {
  $env:COCOCAT_DATA_DIR
} else {
  $DefaultDataRoot
}

function Write-Step([string]$Message) {
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
  Write-Host "OK:  $Message" -ForegroundColor Green
}

function Write-Warn([string]$Message) {
  Write-Host "WARN: $Message" -ForegroundColor Yellow
}

function Fail([string]$Message) {
  Write-Host "FAIL: $Message" -ForegroundColor Red
  exit 1
}

function Get-CommandPath([string]$Name) {
  $cmd = Get-Command $Name -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

function Assert-Command([string]$Name, [string]$InstallHint) {
  $path = Get-CommandPath $Name
  if (-not $path) {
    Fail "$Name not found. $InstallHint"
  }
  Write-Ok "$Name: $path"
}

function Get-NodeMajorVersion {
  $raw = (& node --version 2>$null)
  if ($LASTEXITCODE -ne 0 -or -not $raw) { return 0 }
  return [int](($raw.Trim().TrimStart([char]"v").Split("."))[0])
}

function Ensure-Token {
  $tokenPath = Join-Path $CococatConfig "token"
  if (Test-Path $tokenPath) {
    Write-Ok "token exists: $tokenPath"
    return
  }

  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  $token = -join ($bytes | ForEach-Object { $_.ToString("x2") })
  $token | Set-Content -Path $tokenPath -NoNewline -Encoding ascii
  Write-Ok "token created: $tokenPath"
}

function Ensure-ConfigFile([string]$Name, [string]$ExampleRelPath) {
  $dest = Join-Path $CococatConfig $Name
  if (Test-Path $dest) {
    Write-Ok "$Name exists"
    return
  }
  $src = Join-Path $RuntimeRoot $ExampleRelPath
  if (-not (Test-Path $src)) {
    $src = Join-Path $RepoRoot $ExampleRelPath
  }
  if (Test-Path $src) {
    Copy-Item $src $dest
    Write-Ok "$Name created from $ExampleRelPath"
  } else {
    Write-Warn "$ExampleRelPath missing; skipped $Name"
  }
}

function Docker-ImageExists([string]$Name) {
  docker image inspect $Name *> $null
  return $LASTEXITCODE -eq 0
}

Write-Step "Preparing CocoCat directories"
New-Item -ItemType Directory -Force -Path $CococatConfig | Out-Null
New-Item -ItemType Directory -Force -Path $CococatData | Out-Null
foreach ($dir in @("stack", "data", "wechat-home", "memory")) {
  New-Item -ItemType Directory -Force -Path (Join-Path $CococatData $dir) | Out-Null
}
Write-Ok "config: $CococatConfig"
Write-Ok "data:   $CococatData"

Write-Step "Checking required tools"
Assert-Command "docker" "Install Docker Desktop and start it."
Assert-Command "node" "Install Node.js 22 LTS or newer."
if ($IsSourceCheckout -or $BuildImage) {
  Assert-Command "corepack" "Install Node.js 22 LTS; Corepack is included with Node."
}

$nodeMajor = Get-NodeMajorVersion
if ($nodeMajor -lt 22) {
  Fail "Node.js >=22 is required; current node reports major version $nodeMajor."
}
Write-Ok "node major version: $nodeMajor"

docker info *> $null
if ($LASTEXITCODE -ne 0) {
  Fail "Docker is installed but the daemon is not reachable. Start Docker Desktop and retry."
}
Write-Ok "Docker daemon reachable"

Write-Step "Initializing CocoCat config"
Ensure-Token
Ensure-ConfigFile "agent.env" "config\agent.env.example"

$env:COCOCAT_REPO_ROOT = $RepoRoot
$env:COCOCAT_RESOURCE_ROOT = $RuntimeRoot
$env:COCOCAT_CONFIG_DIR = $CococatConfig
$env:COCOCAT_DATA_DIR = $CococatData
$env:AGENT_WECHAT_DATA_ROOT = $CococatData
$env:AGENT_WECHAT_IMAGE = $Image

Push-Location $RepoRoot
try {
  if (-not $SkipPnpmInstall -and $IsSourceCheckout) {
    Write-Step "Installing Node workspace dependencies"
    & corepack pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { Fail "pnpm install failed" }
    Write-Ok "workspace dependencies installed"
  } elseif (-not $IsSourceCheckout) {
    Write-Warn "No pnpm workspace found at $RepoRoot; assuming packaged runtime resources"
  } else {
    Write-Warn "Skipped pnpm install"
  }

  if ($ImageTar) {
    if (-not (Test-Path $ImageTar)) {
      Fail "Image tar not found: $ImageTar"
    }
    Write-Step "Loading Docker image from $ImageTar"
    docker load -i $ImageTar
    if ($LASTEXITCODE -ne 0) { Fail "docker load failed" }
  }

  if (-not (Docker-ImageExists $Image)) {
    if ($BuildImage) {
      if (-not $IsSourceCheckout) {
        Fail "Cannot build Driver image without a source checkout. Pass -ImageTar <tar> or install from a source checkout."
      }
      Write-Step "Building Driver image $Image"
      & corepack pnpm build:image:amd64
      if ($LASTEXITCODE -ne 0) { Fail "Driver image build failed" }
    } else {
      Fail "Docker image $Image not found. Re-run with -BuildImage, or pass -ImageTar <tar>."
    }
  }
  Write-Ok "Docker image ready: $Image"

  $agentCli = Join-Path $RuntimeRoot "packages\agent\dist\cli.js"
  if (-not $SkipAgentBuild -and $IsSourceCheckout) {
    Write-Step "Building CocoCat Agent"
    & corepack pnpm agent:build
    if ($LASTEXITCODE -ne 0) { Fail "agent build failed" }
    Write-Ok "Agent build ready"
  } elseif (Test-Path $agentCli) {
    Write-Ok "Packaged Agent build ready: $agentCli"
  } elseif (-not $IsSourceCheckout) {
    Fail "Packaged Agent build missing: $agentCli"
  } else {
    Write-Warn "Skipped Agent build"
  }
}
finally {
  Pop-Location
}

Write-Step "Checking stack status"
$stackScript = Join-Path $RuntimeRoot "scripts\cococat-stack.ps1"
if (-not (Test-Path $stackScript)) {
  $stackScript = Join-Path $RepoRoot "scripts\cococat-stack.ps1"
}
& powershell -ExecutionPolicy Bypass -File $stackScript status all

Write-Host ""
Write-Host "CocoCat Windows bootstrap complete." -ForegroundColor Green
Write-Host "Start with: .\start-cococat.cmd"
Write-Host "Config: $CococatConfig"
Write-Host "Data:   $CococatData"
Write-Host "Runtime resources: $RuntimeRoot"
