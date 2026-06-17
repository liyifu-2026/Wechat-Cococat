#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PROTOC_ROOT="${HOME}/.local"

if [[ ! -x "$PROTOC_ROOT/bin/protoc" ]]; then
  bash "$SCRIPT_DIR/install-protoc-local.sh"
fi

export PATH="$PROTOC_ROOT/bin:$PATH"
export PROTOC="$PROTOC_ROOT/bin/protoc"
export PROTOC_INCLUDE="$PROTOC_ROOT/include"

cd "$REPO_ROOT"
pnpm --filter @cococat/shared build
exec pnpm --filter @cococat/console tauri dev "$@"
