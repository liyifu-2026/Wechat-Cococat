#!/usr/bin/env bash
# macOS double-click entry → cococat-stack.sh
DIR="$(cd "$(dirname "$0")" && pwd)"
exec bash "$DIR/cococat-stack.sh" "$@"
