#!/usr/bin/env bash
set -euo pipefail

# Compile the Rust server inside Docker and deploy into a running container.
# Builds in debug mode by default (for debugging). Use --release for optimized builds.
# Usage:
#   ./scripts/dev-deploy.sh                 # debug build (default)
#   ./scripts/dev-deploy.sh --release       # release build
#   ./scripts/dev-deploy.sh --container abc # specify container name/id

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
RUST_DIR="$ROOT_DIR/packages/driver"
BUILDER_IMAGE="rust:1.93-bookworm"
CACHE_VOLUME="agent-wechat-cargo-cache"

CONTAINER=""
BUILD_MODE="debug"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --container)
      CONTAINER="${2:-}"
      shift 2
      ;;
    --release)
      BUILD_MODE="release"
      shift
      ;;
    *)
      echo "unknown argument: $1" >&2
      echo "Usage: $0 [--container name] [--release]" >&2
      exit 1
      ;;
  esac
done

# Auto-detect container
if [ -z "$CONTAINER" ]; then
  CONTAINER=$(docker ps --filter "name=agent-wechat" --format '{{.Names}}' | head -1)
  if [ -z "$CONTAINER" ]; then
    echo "No running agent-wechat container found. Specify with --container" >&2
    exit 1
  fi
fi

# Detect container platform
CONTAINER_ARCH=$(docker inspect --format '{{.Architecture}}' "$CONTAINER" 2>/dev/null || echo "")
case "$CONTAINER_ARCH" in
  amd64)  PLATFORM="linux/amd64" ;;
  arm64)  PLATFORM="linux/arm64" ;;
  *)
    case "$(uname -m)" in
      x86_64)        PLATFORM="linux/amd64" ;;
      aarch64|arm64) PLATFORM="linux/arm64" ;;
      *) echo "Unknown architecture." >&2; exit 1 ;;
    esac
    ;;
esac

CARGO_ARGS="--release"
BINARY_DIR="release"
if [ "$BUILD_MODE" = "debug" ]; then
  CARGO_ARGS=""
  BINARY_DIR="debug"
fi

PROXY_URL="${PROXY:-${HTTP_PROXY:-${HTTPS_PROXY:-http://127.0.0.1:7892}}}"

echo "==> Building in Docker ($PLATFORM, mode=$BUILD_MODE)"
echo "    HTTP proxy: $PROXY_URL (network=host)"
docker run --rm \
  --platform "$PLATFORM" \
  --network=host \
  -e "HTTP_PROXY=$PROXY_URL" \
  -e "HTTPS_PROXY=$PROXY_URL" \
  -e "http_proxy=$PROXY_URL" \
  -e "https_proxy=$PROXY_URL" \
  -v "$RUST_DIR:/build:ro" \
  -v "$CACHE_VOLUME:/build/target" \
  -v "${CACHE_VOLUME}-registry:/usr/local/cargo/registry" \
  -w /build \
  "$BUILDER_IMAGE" \
  cargo build $CARGO_ARGS

echo "==> Deploying to container: $CONTAINER"
TMP_CT=$(docker create -v "$CACHE_VOLUME:/target:ro" "$BUILDER_IMAGE")
STAGING="/tmp/agent-server-deploy-$$"
mkdir -p "$STAGING"
docker cp "$TMP_CT:/target/$BINARY_DIR/agent-server" "$STAGING/agent-server"
docker rm "$TMP_CT" > /dev/null

if [ "$BUILD_MODE" = "debug" ]; then
  LOCAL_BIN="$RUST_DIR/target/debug-remote"
  mkdir -p "$LOCAL_BIN"
  cp "$STAGING/agent-server" "$LOCAL_BIN/agent-server"
  echo "==> Debug binary extracted to $LOCAL_BIN/agent-server"
fi

docker cp "$STAGING/agent-server" "$CONTAINER:/opt/agent-server/agent-server.new"
rm -rf "$STAGING"

docker exec "$CONTAINER" bash -c '
  set -e
  pkill -TERM -x agent-server 2>/dev/null || pkill -TERM -f "^/opt/agent-server/agent-server" 2>/dev/null || true
  for _ in $(seq 1 15); do
    pgrep -x agent-server >/dev/null 2>&1 || pgrep -f "^/opt/agent-server/agent-server" >/dev/null 2>&1 || break
    sleep 1
  done
  mv -f /opt/agent-server/agent-server.new /opt/agent-server/agent-server
  chmod +x /opt/agent-server/agent-server
'

echo "==> Binary replaced; entrypoint will restart agent-server if needed"
