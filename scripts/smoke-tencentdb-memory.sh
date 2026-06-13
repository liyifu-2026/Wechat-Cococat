#!/usr/bin/env bash
# MemoryClient 联调：health → capture → recall
set -euo pipefail

GATEWAY="${TDAI_GATEWAY_URL:-http://127.0.0.1:8420}"
SESSION_KEY="${1:-test_chat_integration}"
AUTH=()
if [[ -n "${TDAI_GATEWAY_API_KEY:-}" ]]; then
  AUTH=(-H "Authorization: Bearer $TDAI_GATEWAY_API_KEY")
fi

echo "== health =="
curl -sf "${GATEWAY}/health" | head -c 500
echo

echo "== capture =="
curl -sf "${AUTH[@]}" -H "Content-Type: application/json" \
  -d "{\"session_key\":\"$SESSION_KEY\",\"user_content\":\"（对方新消息）\\n你好，我喜欢喝拿铁\",\"assistant_content\":\"好呀，拿铁记下了\"}" \
  "${GATEWAY}/capture"
echo

echo "== recall =="
curl -sf "${AUTH[@]}" -H "Content-Type: application/json" \
  -d "{\"session_key\":\"$SESSION_KEY\",\"query\":\"喜欢喝什么\"}" \
  "${GATEWAY}/recall"
echo
