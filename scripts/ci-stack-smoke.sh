#!/usr/bin/env bash
# CI integration smoke: stack scripts + driver HTTP endpoints.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SMOKE_ROOT="$(mktemp -d)"
trap 'rm -rf "$SMOKE_ROOT"' EXIT

export COCOCAT_CONFIG_DIR="$SMOKE_ROOT/config"
export COCOCAT_DATA_DIR="$SMOKE_ROOT/data"
mkdir -p "$COCOCAT_CONFIG_DIR" "$COCOCAT_DATA_DIR/stack"

echo "==> Syntax check cococat-stack.sh"
bash -n "$ROOT_DIR/scripts/cococat-stack.sh"

echo "==> Stack status when services are down"
"$ROOT_DIR/scripts/cococat-stack.sh" status all

echo "==> Driver HTTP smoke"
bash "$ROOT_DIR/scripts/ci-driver-smoke.sh"

echo "==> stack smoke OK"
