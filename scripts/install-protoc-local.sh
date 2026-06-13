#!/usr/bin/env bash
# Install protoc + google protobuf includes to ~/.local (no sudo).
set -euo pipefail

PROTOC_VERSION="${PROTOC_VERSION:-29.3}"
DEST="${HOME}/.local"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) ARCH_TAG=linux-x86_64 ;;
  aarch64|arm64) ARCH_TAG=linux-aarch_64 ;;
  *)
    echo "Unsupported arch: $ARCH" >&2
    exit 1
    ;;
esac

if [[ -x "$DEST/bin/protoc" && -f "$DEST/include/google/protobuf/empty.proto" ]]; then
  echo "protoc already installed: $($DEST/bin/protoc --version)"
  exit 0
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

URL="https://github.com/protocolbuffers/protobuf/releases/download/v${PROTOC_VERSION}/protoc-${PROTOC_VERSION}-${ARCH_TAG}.zip"
echo "Downloading $URL"
curl -fsSL "$URL" -o "$TMP/protoc.zip"
unzip -qo "$TMP/protoc.zip" -d "$TMP"
mkdir -p "$DEST/bin"
install -m 755 "$TMP/bin/protoc" "$DEST/bin/protoc"
rm -rf "$DEST/include"
cp -r "$TMP/include" "$DEST/"
echo "Installed $($DEST/bin/protoc --version) to $DEST/bin/protoc"
