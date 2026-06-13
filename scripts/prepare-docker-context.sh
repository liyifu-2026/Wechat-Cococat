#!/usr/bin/env bash
# Sync packages/driver into docker/agent-server-rust for image builds.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKER_DIR="${DOCKER_DIR:-$ROOT_DIR/docker}"
DEST="$DOCKER_DIR/agent-server-rust"
SRC="$ROOT_DIR/packages/driver"

echo "==> Preparing Docker build context"
rm -rf "$DEST"
mkdir -p "$DEST"

cp "$SRC/Cargo.toml" "$DEST/"
if [[ -f "$SRC/Cargo.lock" ]]; then
  cp "$SRC/Cargo.lock" "$DEST/"
fi
cp -r "$SRC/src" "$DEST/"
cp -r "$SRC/migrations" "$DEST/"
if [[ -d "$SRC/tests" ]]; then
  cp -r "$SRC/tests" "$DEST/"
fi
if [[ -d "$SRC/data" ]]; then
  cp -r "$SRC/data" "$DEST/"
else
  mkdir -p "$DEST/data"
fi

echo "==> Docker context ready at $DEST"
