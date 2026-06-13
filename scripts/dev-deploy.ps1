# Compile agent-server in Docker and hot-deploy into a running container.
# Windows equivalent of dev-deploy.sh (avoids CRLF issues under WSL bash).
#
# Usage:
#   .\scripts\dev-deploy.ps1                 # release build (default)
#   .\scripts\dev-deploy.ps1 -Debug          # debug build
#   .\scripts\dev-deploy.ps1 -Container abc  # specify container name

param(
    [string]$Container = "",
    [switch]$Debug
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$RustDir = Join-Path $RootDir "agent-server-rust"
$BuilderImage = "rust:1.93-bookworm"
$CacheVolume = "agent-wechat-cargo-cache"

if (-not $Container) {
    $Container = docker ps --filter "name=agent-wechat" --format "{{.Names}}" 2>$null | Select-Object -First 1
    if (-not $Container) {
        Write-Error "No running agent-wechat container found. Use -Container to specify one."
    }
}

$imageId = docker inspect --format "{{.Image}}" $Container 2>$null
$ContainerArch = docker image inspect --format "{{.Architecture}}" $imageId 2>$null
if (-not $ContainerArch) {
    $ContainerArch = docker inspect --format "{{.Architecture}}" $Container 2>$null
}
switch ($ContainerArch) {
    "amd64" { $Platform = "linux/amd64" }
    "arm64" { $Platform = "linux/arm64" }
    default {
        switch ($env:PROCESSOR_ARCHITECTURE) {
            "AMD64" { $Platform = "linux/amd64" }
            "ARM64" { $Platform = "linux/arm64" }
            default { Write-Error "Unknown architecture: $ContainerArch" }
        }
    }
}

if ($Debug) {
    $CargoArgs = ""
    $BinaryDir = "debug"
    $BuildMode = "debug"
} else {
    $CargoArgs = "--release"
    $BinaryDir = "release"
    $BuildMode = "release"
}

Write-Host "==> Building in Docker ($Platform, mode=$BuildMode)"

$RustDirDocker = ($RustDir -replace '\\', '/')
docker run --rm `
    --platform $Platform `
    -v "${RustDirDocker}:/build:ro" `
    -v "${CacheVolume}:/build/target" `
    -v "${CacheVolume}-registry:/usr/local/cargo/registry" `
    -w /build `
    $BuilderImage `
    cargo build $CargoArgs

Write-Host "==> Deploying to container: $Container"

$Staging = Join-Path $env:TEMP "agent-server-deploy-$PID"
New-Item -ItemType Directory -Force -Path $Staging | Out-Null

try {
    $TmpCt = docker create -v "${CacheVolume}:/target:ro" $BuilderImage
    docker cp "${TmpCt}:/target/$BinaryDir/agent-server" (Join-Path $Staging "agent-server")
    docker rm $TmpCt | Out-Null

    if ($Debug) {
        $LocalBin = Join-Path $RustDir "target\debug-remote"
        New-Item -ItemType Directory -Force -Path $LocalBin | Out-Null
        Copy-Item (Join-Path $Staging "agent-server") (Join-Path $LocalBin "agent-server") -Force
        Write-Host "==> Debug binary extracted to $LocalBin\agent-server"
    }

    docker cp (Join-Path $Staging "agent-server") "${Container}:/opt/agent-server/agent-server.new"

    docker exec $Container bash -lc 'set -e; pkill -TERM -x agent-server 2>/dev/null || pkill -TERM -f "^/opt/agent-server/agent-server" 2>/dev/null || true; for _ in $(seq 1 15); do pgrep -x agent-server >/dev/null 2>&1 || pgrep -f "^/opt/agent-server/agent-server" >/dev/null 2>&1 || break; sleep 1; done; mv -f /opt/agent-server/agent-server.new /opt/agent-server/agent-server; chmod +x /opt/agent-server/agent-server'

    Write-Host "==> Binary replaced; entrypoint will restart agent-server if needed"
    Write-Host "==> Run .\scripts\smoke-container.ps1 to verify deployment"
}
finally {
    Remove-Item -Recurse -Force $Staging -ErrorAction SilentlyContinue
}
