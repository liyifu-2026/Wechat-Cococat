#!/usr/bin/env bash
# Fail when generated, local, or secret-bearing files are tracked by Git.
set -euo pipefail

violations=()

while IFS= read -r path; do
  case "$path" in
    node_modules/*|*/node_modules/*|\
    dist/*|*/dist/*|\
    target/*|*/target/*|\
    .turbo/*|*/.turbo/*|\
    docker/agent-server-rust/*|\
    apps/console/src-tauri/runtime/*|\
    docker/wechat.deb|docker/*.partial|\
    .env|*/.env|.env.local|*/.env.local|\
    wechat_files/*|.data/*)
      violations+=("$path")
      ;;
  esac
done < <(git ls-files)

if ((${#violations[@]} > 0)); then
  echo "Repository hygiene check failed. Generated or local files are tracked:" >&2
  printf '  %s\n' "${violations[@]}" >&2
  exit 1
fi

echo "Repository hygiene check passed."
