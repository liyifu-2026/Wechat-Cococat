#!/usr/bin/env bash
# CocoCat stack control: Driver (docker) + Memory (gateway) + Agent (pi-wechat)
#
# Usage:
#   ./scripts/cococat-stack.sh status [driver|memory|agent|all]
#   ./scripts/cococat-stack.sh start  [driver|memory|agent|all]
#   ./scripts/cococat-stack.sh stop   [driver|memory|agent|all]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -n "${COCOCAT_REPO_ROOT:-}" && -d "$COCOCAT_REPO_ROOT" ]]; then
  REPO_ROOT="$(cd "$COCOCAT_REPO_ROOT" && pwd)"
else
  REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
fi

setup_path() {
  local nvm_bin=""
  if [[ -d "$HOME/.nvm/versions/node" ]]; then
    nvm_bin="$(find "$HOME/.nvm/versions/node" -maxdepth 3 -type f -name node 2>/dev/null | sort -V | tail -1)"
    if [[ -n "$nvm_bin" ]]; then
      nvm_bin="$(dirname "$nvm_bin")"
    fi
  fi
  export PATH="${nvm_bin:+$nvm_bin:}$REPO_ROOT/node_modules/.bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"
}

find_node() {
  setup_path
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi
  for candidate in /usr/local/bin/node /usr/bin/node; do
    if [[ -x "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done
  echo "node: not found in PATH (GUI apps often lack node/pnpm — run from terminal or add node to PATH)" >&2
  return 1
}

docker_ok() {
  docker ps >/dev/null 2>&1
}

# Run a command with docker group membership when the current session lacks it.
with_docker() {
  if docker_ok; then
    "$@"
  else
    sg docker -c "$(printf '%q ' "$@")"
  fi
}

with_docker_shell() {
  local script="$1"
  if docker_ok; then
    bash -lc "$script"
  else
    sg docker -c "bash -lc $(printf '%q' "$script")"
  fi
}

COCOCAT_CONFIG="${COCOCAT_CONFIG_DIR:-$HOME/.config/cococat}"
COCOCAT_DATA="${COCOCAT_DATA_DIR:-$HOME/.local/share/cococat}"
STACK_DIR="$COCOCAT_DATA/stack"
MEMORY_DATA="$COCOCAT_DATA/memory"
MEMORY_ENV="${TENCENTDB_ENV_FILE:-$COCOCAT_CONFIG/memory.env}"
if [[ ! -f "$MEMORY_ENV" ]]; then
  MEMORY_ENV="$COCOCAT_CONFIG/agent.env"
fi

DRIVER_URL="${AGENT_WECHAT_URL:-http://127.0.0.1:6174}"
MEMORY_URL="${TDAI_GATEWAY_URL:-http://127.0.0.1:8420}"
MEMORY_URL="${MEMORY_URL%/}"

DRIVER_PID="$STACK_DIR/driver.pid"
MEMORY_PID="$STACK_DIR/memory.pid"
AGENT_PID="$STACK_DIR/agent.pid"
AGENT_LOG="$STACK_DIR/agent.log"

ACTION="${1:-status}"
SERVICE="${2:-all}"

mkdir -p "$STACK_DIR" "$COCOCAT_CONFIG" "$COCOCAT_DATA/memory"

read_token() {
  local p="$COCOCAT_CONFIG/token"
  if [[ -f "$p" ]]; then
    tr -d ' \n' <"$p"
    return 0
  fi
  return 1
}

pid_alive() {
  local pid_file="$1"
  [[ -f "$pid_file" ]] || return 1
  local pid
  pid="$(cat "$pid_file" 2>/dev/null || true)"
  [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null
}

status_driver() {
  local token=""
  token="$(read_token 2>/dev/null || true)"
  local auth_header=()
  if [[ -n "$token" ]]; then
    auth_header=(-H "Authorization: Bearer $token")
  fi
  if curl -sf "${auth_header[@]}" "${DRIVER_URL}/api/status" >/dev/null 2>&1; then
    echo "driver: up ($DRIVER_URL)"
    return 0
  fi
  if with_docker docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'agent-wechat'; then
    echo "driver: container running but API unreachable ($DRIVER_URL)"
    return 1
  fi
  echo "driver: down"
  return 1
}

status_memory() {
  if curl -sf "${MEMORY_URL}/health" >/dev/null 2>&1; then
    echo "memory: up ($MEMORY_URL)"
    return 0
  fi
  if pid_alive "$MEMORY_PID"; then
    echo "memory: pid $(cat "$MEMORY_PID") but health failed"
    return 1
  fi
  echo "memory: down"
  return 1
}

status_agent() {
  if pid_alive "$AGENT_PID"; then
    echo "agent: up pid=$(cat "$AGENT_PID")"
    return 0
  fi
  echo "agent: down"
  return 1
}

stop_pidfile() {
  local name="$1"
  local pid_file="$2"
  if pid_alive "$pid_file"; then
    local pid
    pid="$(cat "$pid_file")"
    kill "$pid" 2>/dev/null || true
    sleep 1
    kill -9 "$pid" 2>/dev/null || true
    echo "stopped $name pid=$pid"
  else
    echo "$name: not running"
  fi
  rm -f "$pid_file"
}

_run_driver_up() {
  setup_path
  export AGENT_WECHAT_DATA_ROOT="$COCOCAT_DATA"
  export COCOCAT_CONFIG_DIR="$COCOCAT_CONFIG"
  cd "$REPO_ROOT"
  if command -v docker-compose >/dev/null 2>&1; then
    docker-compose up -d
  elif docker compose version >/dev/null 2>&1; then
    docker compose up -d
  elif [[ -f "$REPO_ROOT/packages/cli/dist/cli.js" ]]; then
    local node_bin
    node_bin="$(find_node)"
    "$node_bin" "$REPO_ROOT/packages/cli/dist/cli.js" up
  else
    echo "driver: need docker compose or built CLI ($REPO_ROOT/packages/cli/dist/cli.js)"
    return 1
  fi
}

start_driver() {
  if status_driver >/dev/null 2>&1; then
    echo "driver: already up"
    return 0
  fi
  if [[ ! -f "$COCOCAT_CONFIG/token" ]]; then
    mkdir -p "$COCOCAT_CONFIG"
    openssl rand -hex 32 >"$COCOCAT_CONFIG/token"
    chmod 600 "$COCOCAT_CONFIG/token"
  fi
  setup_path
  if docker_ok; then
    _run_driver_up
  else
    with_docker_shell "
      export PATH='${PATH//\'/\'\\\'\'}\''
      export AGENT_WECHAT_DATA_ROOT='${COCOCAT_DATA//\'/\'\\\'\'}\''
      export COCOCAT_CONFIG_DIR='${COCOCAT_CONFIG//\'/\'\\\'\'}\''
      cd '${REPO_ROOT//\'/\'\\\'\'}\''
      if command -v docker-compose >/dev/null 2>&1; then
        docker-compose up -d
      elif docker compose version >/dev/null 2>&1; then
        docker compose up -d
      elif [[ -f '${REPO_ROOT}/packages/cli/dist/cli.js' ]]; then
        node_bin=\$(command -v node || echo /usr/bin/node)
        \"\$node_bin\" '${REPO_ROOT}/packages/cli/dist/cli.js' up
      else
        echo 'driver: need docker compose or built CLI'
        exit 1
      fi
    "
  fi
  sleep 2
  status_driver
}

stop_driver() {
  setup_path
  cd "$REPO_ROOT"
  with_docker_shell "
    cd '$REPO_ROOT'
    docker compose down 2>/dev/null || docker stop agent-wechat 2>/dev/null || true
  "
  rm -f "$DRIVER_PID"
  echo "driver: stopped"
}

start_memory() {
  if status_memory >/dev/null 2>&1; then
    echo "memory: already up"
    return 0
  fi
  export TENCENTDB_ENV_FILE="$MEMORY_ENV"
  export AGENT_WECHAT_DATA_ROOT="$COCOCAT_DATA"
  export TDAI_DATA_DIR="${TDAI_DATA_DIR:-$MEMORY_DATA}"
  bash "$REPO_ROOT/scripts/start-tencentdb-gateway.sh"
  if [[ -f "$MEMORY_DATA/gateway.pid" ]]; then
    cp "$MEMORY_DATA/gateway.pid" "$MEMORY_PID"
  fi
  status_memory
}

stop_memory() {
  export TDAI_DATA_DIR="${TDAI_DATA_DIR:-$MEMORY_DATA}"
  bash "$REPO_ROOT/scripts/start-tencentdb-gateway.sh" stop 2>/dev/null || true
  stop_pidfile memory "$MEMORY_PID"
}

start_agent() {
  if pid_alive "$AGENT_PID"; then
    echo "agent: already up pid=$(cat "$AGENT_PID")"
    return 0
  fi
  if ! status_driver >/dev/null 2>&1; then
    echo "agent: driver not up — start driver first"
    return 1
  fi
  local agent_env="$COCOCAT_CONFIG/agent.env"
  if [[ -f "$agent_env" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$agent_env"
    set +a
  fi
  export COCOCAT_CONFIG_DIR="$COCOCAT_CONFIG"
  export COCOCAT_DATA_DIR="$COCOCAT_DATA"
  export AGENT_WECHAT_DATA_ROOT="$COCOCAT_DATA"
  local token
  token="$(read_token)" || {
    echo "agent: missing token in $COCOCAT_CONFIG/token"
    return 1
  }
  export AGENT_WECHAT_TOKEN="$token"
  setup_path
  cd "$REPO_ROOT"
  local node_bin agent_cli="$REPO_ROOT/packages/agent/dist/cli.js"
  node_bin="$(find_node)"
  if [[ ! -f "$agent_cli" ]]; then
    echo "agent: building @cococat/agent..."
    if command -v pnpm >/dev/null 2>&1; then
      pnpm agent:build
    elif [[ -x "$REPO_ROOT/node_modules/.bin/tsc" ]]; then
      (cd "$REPO_ROOT/packages/shared" && "$REPO_ROOT/node_modules/.bin/tsc")
      (cd "$REPO_ROOT/packages/agent" && "$REPO_ROOT/node_modules/.bin/tsc")
    else
      echo "agent: missing $agent_cli — run: cd $REPO_ROOT && pnpm agent:build"
      return 1
    fi
  fi
  nohup "$node_bin" "$agent_cli" >>"$AGENT_LOG" 2>&1 &
  echo $! >"$AGENT_PID"
  sleep 2
  status_agent
}

stop_agent() {
  stop_pidfile agent "$AGENT_PID"
}

run_service() {
  local op="$1"
  local svc="$2"
  case "$svc" in
    driver) "$op"_driver ;;
    memory) "$op"_memory ;;
    agent) "$op"_agent ;;
    all)
      if [[ "$op" == start ]]; then
        start_driver
        start_memory || true
        start_agent
      else
        stop_agent
        stop_memory
        stop_driver
      fi
      ;;
    *) echo "unknown service: $svc"; return 1 ;;
  esac
}

case "$ACTION" in
  status)
    if [[ "$SERVICE" == all ]]; then
      status_driver || true
      status_memory || true
      status_agent || true
    else
      run_service status "$SERVICE"
    fi
    ;;
  start|stop)
    run_service "$ACTION" "$SERVICE"
    ;;
  *)
    echo "Usage: $0 {status|start|stop} [driver|memory|agent|all]"
    exit 1
    ;;
esac
