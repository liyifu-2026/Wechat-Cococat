#!/usr/bin/env bash
# Migrate ~/.config/agent-wechat and ~/.local/share/agent-wechat → cococat paths.
#
# Usage: ./scripts/cococat-migrate-config.sh [--force-copy]

set -euo pipefail

FORCE="${1:-}"

LEGACY_CONFIG="${HOME}/.config/agent-wechat"
LEGACY_DATA="${HOME}/.local/share/agent-wechat"
COCOCAT_CONFIG="${COCOCAT_CONFIG_DIR:-${HOME}/.config/cococat}"
COCOCAT_DATA="${COCOCAT_DATA_DIR:-${HOME}/.local/share/cococat}"

copy_if_missing() {
  local src="$1"
  local dst="$2"
  if [[ ! -e "$src" ]]; then
    return 0
  fi
  if [[ -e "$dst" && "$FORCE" != "--force-copy" ]]; then
    echo "skip (exists): $dst"
    return 0
  fi
  mkdir -p "$(dirname "$dst")"
  if [[ -d "$src" ]]; then
    mkdir -p "$dst"
    if command -v rsync >/dev/null 2>&1; then
      rsync -a --ignore-errors "$src/" "$dst/" || true
    else
      cp -a "$src/." "$dst/" 2>/dev/null || true
    fi
  else
    cp -a "$src" "$dst"
  fi
  echo "migrated: $src → $dst"
}

mkdir -p "$COCOCAT_CONFIG" "$COCOCAT_DATA/stack" "$COCOCAT_DATA/chats" "$COCOCAT_DATA/memory"

if [[ ! -d "$LEGACY_CONFIG" && ! -d "$LEGACY_DATA" ]]; then
  echo "No legacy agent-wechat directories found. Cococat paths ready at:"
  echo "  $COCOCAT_CONFIG"
  echo "  $COCOCAT_DATA"
  exit 0
fi

echo "Migrating to:"
echo "  config: $COCOCAT_CONFIG"
echo "  data:   $COCOCAT_DATA"

if [[ -d "$LEGACY_CONFIG" ]]; then
  for f in token persona.md persona.example.md bridge-groups.json wiki-registry.json wiki-default.json seen.json; do
    copy_if_missing "$LEGACY_CONFIG/$f" "$COCOCAT_CONFIG/$f"
  done
  copy_if_missing "$LEGACY_CONFIG/pi-wechat.env" "$COCOCAT_CONFIG/agent.env"
  copy_if_missing "$LEGACY_CONFIG/tencentdb-memory.env" "$COCOCAT_CONFIG/memory.env"
  # Also keep legacy filenames if new names missing
  copy_if_missing "$LEGACY_CONFIG/pi-wechat.env" "$COCOCAT_CONFIG/pi-wechat.env"
  copy_if_missing "$LEGACY_CONFIG/tencentdb-memory.env" "$COCOCAT_CONFIG/tencentdb-memory.env"
fi

if [[ -d "$LEGACY_DATA/chats" ]]; then
  copy_if_missing "$LEGACY_DATA/chats" "$COCOCAT_DATA/chats"
fi

if [[ -d "$LEGACY_DATA/tencentdb-memory" ]]; then
  copy_if_missing "$LEGACY_DATA/tencentdb-memory" "$COCOCAT_DATA/memory"
fi

for sub in wechat-home data; do
  copy_if_missing "$LEGACY_DATA/$sub" "$COCOCAT_DATA/$sub"
done

if [[ ! -f "$COCOCAT_CONFIG/token" ]]; then
  mkdir -p "$COCOCAT_CONFIG"
  openssl rand -hex 32 >"$COCOCAT_CONFIG/token"
  chmod 600 "$COCOCAT_CONFIG/token"
  echo "generated token: $COCOCAT_CONFIG/token"
fi

echo "Done. Set COCOCAT_CONFIG_DIR / COCOCAT_DATA_DIR if using custom paths."
