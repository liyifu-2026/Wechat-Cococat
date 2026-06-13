#!/usr/bin/env bash
# Start a release driver binary and verify /health + /api/status.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SMOKE_DIR="$(mktemp -d)"
SERVER_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
  rm -rf "$SMOKE_DIR"
}
trap cleanup EXIT

TOKEN="ci-smoke-token"
if [[ -n "${CI_DRIVER_PORT:-}" ]]; then
  PORT="$CI_DRIVER_PORT"
else
  PORT="$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1", 0)); print(s.getsockname()[1]); s.close()')"
fi
DB_PATH="$SMOKE_DIR/agent.db"
HEALTH_URL="http://127.0.0.1:${PORT}/health"
STATUS_URL="http://127.0.0.1:${PORT}/api/status"

echo "==> Building driver (release)"
cargo build --release --manifest-path "$ROOT_DIR/packages/driver/Cargo.toml"

BIN="$ROOT_DIR/packages/driver/target/release/agent-server"
if [[ ! -x "$BIN" ]]; then
  echo "missing driver binary: $BIN" >&2
  exit 1
fi

echo "==> Starting driver on ${HEALTH_URL}"
AGENT_WECHAT_TOKEN="$TOKEN" \
AGENT_DB_PATH="$DB_PATH" \
AGENT_PORT="$PORT" \
AGENT_HOST="127.0.0.1" \
"$BIN" >/tmp/cococat-driver-smoke.log 2>&1 &
SERVER_PID=$!

deadline=$((SECONDS + 45))
until curl -sf "$HEALTH_URL" >/dev/null 2>&1; do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "driver exited before /health became ready" >&2
    tail -40 /tmp/cococat-driver-smoke.log >&2 || true
    exit 1
  fi
  if (( SECONDS >= deadline )); then
    echo "timed out waiting for $HEALTH_URL" >&2
    tail -40 /tmp/cococat-driver-smoke.log >&2 || true
    exit 1
  fi
  sleep 0.5
done

health_body="$(curl -sf "$HEALTH_URL")"
echo "==> GET /health -> $health_body"
if [[ "$health_body" != *'"status"'* || "$health_body" != *'ok'* ]]; then
  echo "unexpected /health body" >&2
  exit 1
fi

status_body="$(curl -sf -H "Authorization: Bearer $TOKEN" "$STATUS_URL")"
echo "==> GET /api/status -> $status_body"
if [[ "$status_body" != *'"container"'* ]]; then
  echo "unexpected /api/status body" >&2
  exit 1
fi

echo "==> driver smoke OK"
