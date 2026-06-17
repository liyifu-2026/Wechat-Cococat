#!/usr/bin/env bash
# 本地启动 TencentDB Memory Gateway（无需 Docker）
#
# 用法:
#   PROXY=http://127.0.0.1:7892 ./scripts/start-tencentdb-gateway.sh
#   ./scripts/start-tencentdb-gateway.sh stop

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENV_FILE="${TENCENTDB_ENV_FILE:-$HOME/.config/cococat/memory.env}"
if [[ ! -f "$ENV_FILE" ]]; then
  ENV_FILE="$HOME/.config/cococat/agent.env"
fi
DATA_DIR="${TDAI_DATA_DIR:-${COCOCAT_DATA_DIR:-$HOME/.local/share/cococat}/memory}"
PID_FILE="$DATA_DIR/gateway.pid"
LOG_FILE="$DATA_DIR/gateway.log"
COCOCAT_DATA="${COCOCAT_DATA_DIR:-$HOME/.local/share/cococat}"
GATEWAY_ROOT="${TDAI_GATEWAY_ROOT:-$COCOCAT_DATA/TencentDB-Agent-Memory}"
GATEWAY_SRC="$GATEWAY_ROOT/src/gateway/server.ts"

PROXY_URL="${PROXY:-${HTTP_PROXY:-http://127.0.0.1:7892}}"

stop_gateway() {
  if [[ -f "$PID_FILE" ]]; then
    local pid
    pid="$(cat "$PID_FILE")"
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      echo "Stopped gateway pid=$pid"
    fi
    rm -f "$PID_FILE"
  fi
}

if [[ "${1:-}" == "stop" ]]; then
  stop_gateway
  exit 0
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE — copy config/tencentdb-memory.env.example and edit."
  exit 1
fi

if [[ ! -f "$GATEWAY_SRC" ]]; then
  echo "Missing gateway source: $GATEWAY_SRC"
  echo "One-time clone (survives reboot):"
  echo "  git clone --depth 1 https://github.com/TencentCloud/TencentDB-Agent-Memory.git $GATEWAY_ROOT"
  echo "Or with proxy: PROXY=$PROXY_URL git clone --depth 1 https://github.com/TencentCloud/TencentDB-Agent-Memory.git $GATEWAY_ROOT"
  exit 1
fi

GATEWAY_DIR="$GATEWAY_ROOT"
if [[ ! -d "$GATEWAY_DIR/node_modules" ]]; then
  echo "Installing gateway deps in $GATEWAY_DIR ..."
  (cd "$GATEWAY_DIR" && export http_proxy="$PROXY_URL" https_proxy="$PROXY_URL" && npm install)
fi

mkdir -p "$DATA_DIR"
stop_gateway

set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

export TDAI_DATA_DIR="${TDAI_DATA_DIR:-$DATA_DIR}"
export TDAI_GATEWAY_HOST="${TDAI_GATEWAY_HOST:-127.0.0.1}"
export TDAI_GATEWAY_PORT="${TDAI_GATEWAY_PORT:-8420}"

cd "$GATEWAY_DIR"
nohup node --import tsx/esm "$GATEWAY_SRC" >>"$LOG_FILE" 2>&1 &
gateway_pid=$!
echo "$gateway_pid" >"$PID_FILE"

# Core init (sqlite, BM25, LLM runners) often takes >2s; wait up to 45s.
health_url="http://${TDAI_GATEWAY_HOST}:${TDAI_GATEWAY_PORT}/health"
ready=0
for _ in $(seq 1 45); do
  if ! kill -0 "$gateway_pid" 2>/dev/null; then
    echo "Gateway process exited during startup (pid=$gateway_pid)."
    echo "Last log lines:"
    tail -25 "$LOG_FILE" 2>/dev/null || true
    rm -f "$PID_FILE"
    exit 1
  fi
  if curl -sf "$health_url" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done

if [[ "$ready" -eq 1 ]]; then
  echo "Gateway OK: $health_url (pid=$gateway_pid)"
  echo "Log: $LOG_FILE"
else
  echo "Gateway health check timed out after 45s (pid=$gateway_pid may still be starting)."
  echo "Try: curl -sf $health_url && pnpm stack status memory"
  echo "Last log lines:"
  tail -25 "$LOG_FILE" 2>/dev/null || true
  exit 1
fi
