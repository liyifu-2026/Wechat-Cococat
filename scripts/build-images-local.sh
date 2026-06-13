#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
DOCKER_DIR="$ROOT_DIR/docker"
DOCKERFILE="$DOCKER_DIR/Dockerfile"

ARCH_ONLY=""
NO_CACHE=0
BUILD_MODE="release"

while [ "$#" -gt 0 ]; do
  case "$1" in
    --)
      shift
      ;;
    --no-cache)
      NO_CACHE=1
      shift
      ;;
    --debug)
      BUILD_MODE="debug"
      shift
      ;;
    --arch)
      ARCH_ONLY="${2:-}"
      shift 2
      ;;
    *)
      echo "unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

prepare_build_context() {
  bash "$ROOT_DIR/scripts/prepare-docker-context.sh"
}

cleanup_build_context() {
  echo "==> Cleaning up build context"
  rm -rf "$DOCKER_DIR/agent-server-rust"
}

build_arch() {
  local platform="$1"
  local tag="$2"

  local proxy_url="${PROXY:-${HTTP_PROXY:-${HTTPS_PROXY:-http://127.0.0.1:7892}}}"
  local apt_mirror="${APT_MIRROR:-mirrors.aliyun.com}"
  # --network=host so 127.0.0.1:7892 reaches Clash on the host (not bind-all)
  local build_proxy="$proxy_url"

  echo "==> Building ${tag} (${platform})"
  echo "    Apt mirror: ${apt_mirror} (direct, no apt proxy)"
  echo "    HTTP proxy: ${build_proxy} (cargo/curl/pip only, network=host)"
  echo "    WeChat .deb will be downloaded inside Docker build"
  docker buildx build \
    ${NO_CACHE:+--no-cache} \
    --network=host \
    --platform "$platform" \
    --build-arg BUILD_MODE="$BUILD_MODE" \
    --build-arg APT_MIRROR="$apt_mirror" \
    --build-arg HTTP_PROXY="$build_proxy" \
    --build-arg HTTPS_PROXY="$build_proxy" \
    -t "$tag" \
    --load \
    -f "$DOCKERFILE" \
    "$DOCKER_DIR"
}

# Auto-detect architecture if not specified
if [ -z "$ARCH_ONLY" ]; then
  case "$(uname -m)" in
    x86_64)          ARCH_ONLY="amd64" ;;
    aarch64|arm64)   ARCH_ONLY="arm64" ;;
    *)
      echo "Unknown host architecture: $(uname -m). Use --arch to specify." >&2
      exit 1
      ;;
  esac
  echo "==> Auto-detected architecture: $ARCH_ONLY"
fi

# Prepare build context (copy Rust source)
prepare_build_context

# Ensure cleanup on exit
trap cleanup_build_context EXIT

case "$ARCH_ONLY" in
  amd64)
    build_arch "linux/amd64" "agent-wechat:amd64"
    printf "\nDone. Built: agent-wechat:amd64\n"
    ;;
  arm64)
    build_arch "linux/arm64" "agent-wechat:arm64"
    printf "\nDone. Built: agent-wechat:arm64\n"
    ;;
  both)
    build_arch "linux/amd64" "agent-wechat:amd64"
    build_arch "linux/arm64" "agent-wechat:arm64"
    printf "\nDone. Built: agent-wechat:amd64, agent-wechat:arm64\n"
    ;;
  *)
    echo "unsupported arch: $ARCH_ONLY (use amd64, arm64, or both)" >&2
    exit 1
    ;;
esac
