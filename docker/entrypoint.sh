#!/usr/bin/env bash
set -euo pipefail

# ============================================
# Environment setup
# ============================================
export DISPLAY=${DISPLAY:-:99}
export QT_ACCESSIBILITY=${QT_ACCESSIBILITY:-1}
export QT_LINUX_ACCESSIBILITY_ALWAYS_ON=${QT_LINUX_ACCESSIBILITY_ALWAYS_ON:-1}
export GTK_MODULES=${GTK_MODULES:-gail:atk-bridge}
export WECHAT_HOME=${WECHAT_HOME:-/home/wechat}
export COCOCAT_DESKTOP_PATH="/opt/cococat/bin:/opt/tools:${PATH:-/usr/local/bin:/usr/bin:/bin}"
# Suppress libcanberra/GTK event sounds from libnotify clients (WeChat refresh, etc.).
export LIBCANBERRA_CACHE_ONLY=${LIBCANBERRA_CACHE_ONLY:-1}
export CANBERRA_CACHE_ONLY=${CANBERRA_CACHE_ONLY:-1}
export PULSE_SINK=${COCOCAT_PULSE_SINK:-silent}

# ============================================
# X11 setup
# ============================================
if [ "$(id -u)" -eq 0 ]; then
  mkdir -p /tmp/.X11-unix
  chown root:root /tmp/.X11-unix
  chmod 1777 /tmp/.X11-unix
fi

if [ -f /tmp/.X99-lock ]; then
  rm -f /tmp/.X99-lock
fi

# ============================================
# Transparent proxy via redsocks (optional)
# ============================================
if [ -n "${PROXY:-}" ]; then
  REDSOCKS_TYPE="http-connect"
  PROXY_VAL="$PROXY"

  # Strip optional scheme prefix
  if echo "$PROXY_VAL" | grep -q '^socks5://'; then
    REDSOCKS_TYPE="socks5"
    PROXY_VAL="${PROXY_VAL#socks5://}"
  elif echo "$PROXY_VAL" | grep -q '^http://'; then
    PROXY_VAL="${PROXY_VAL#http://}"
  fi

  # Parse user:pass@host:port or host:port
  PROXY_USER=""
  PROXY_PASS=""
  if echo "$PROXY_VAL" | grep -q '@'; then
    PROXY_USERINFO="${PROXY_VAL%%@*}"
    PROXY_HOSTPORT="${PROXY_VAL##*@}"
    PROXY_USER="${PROXY_USERINFO%%:*}"
    PROXY_PASS="${PROXY_USERINFO#*:}"
  else
    PROXY_HOSTPORT="$PROXY_VAL"
  fi

  # Split host:port
  PROXY_HOST=$(echo "$PROXY_HOSTPORT" | rev | cut -d: -f2- | rev)
  PROXY_PORT=$(echo "$PROXY_HOSTPORT" | rev | cut -d: -f1 | rev)

  echo "Configuring transparent proxy: $PROXY_HOST:$PROXY_PORT ($REDSOCKS_TYPE)"

  # Generate redsocks config
  cat > /tmp/redsocks.conf <<REDSOCKS_EOF
base {
    log_debug = off;
    log_info = on;
    daemon = on;
    redirector = iptables;
}

redsocks {
    local_ip = 127.0.0.1;
    local_port = 12345;
    ip = $PROXY_HOST;
    port = $PROXY_PORT;
    type = $REDSOCKS_TYPE;
$([ -n "$PROXY_USER" ] && echo "    login = \"$PROXY_USER\";")
$([ -n "$PROXY_PASS" ] && echo "    password = \"$PROXY_PASS\";")
}
REDSOCKS_EOF

  # Create dedicated user for redsocks (iptables uid exclusion prevents redirect loop)
  id -u redsocks >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin redsocks
  chown redsocks /tmp/redsocks.conf

  # Start redsocks as dedicated user
  su -s /bin/sh -c "redsocks -c /tmp/redsocks.conf" redsocks

  # iptables: redirect all outgoing TCP through redsocks
  # Skip redsocks' own traffic to prevent redirect loop
  # Skip local/private ranges to preserve internal services
  iptables -t nat -N REDSOCKS
  iptables -t nat -A REDSOCKS -m owner --uid-owner redsocks -j RETURN
  iptables -t nat -A REDSOCKS -d 0.0.0.0/8 -j RETURN
  iptables -t nat -A REDSOCKS -d 10.0.0.0/8 -j RETURN
  iptables -t nat -A REDSOCKS -d 127.0.0.0/8 -j RETURN
  iptables -t nat -A REDSOCKS -d 169.254.0.0/16 -j RETURN
  iptables -t nat -A REDSOCKS -d 172.16.0.0/12 -j RETURN
  iptables -t nat -A REDSOCKS -d 192.168.0.0/16 -j RETURN
  iptables -t nat -A REDSOCKS -d 224.0.0.0/4 -j RETURN
  iptables -t nat -A REDSOCKS -d 240.0.0.0/4 -j RETURN
  iptables -t nat -A REDSOCKS -p tcp -j REDIRECT --to-ports 12345
  iptables -t nat -A OUTPUT -p tcp -j REDSOCKS

  echo "Transparent proxy configured."
fi

# ============================================
# Start Xvfb
# ============================================
Xvfb "$DISPLAY" -screen 0 1280x800x24 &
sleep 1

# ============================================
# Start D-Bus session as wechat user
# This ensures AT-SPI socket is accessible to wechat
# ============================================
DBUS_OUTPUT=$(su -s /bin/bash -c "dbus-launch --sh-syntax" wechat)
eval "$DBUS_OUTPUT"
export DBUS_SESSION_BUS_ADDRESS

echo "D-Bus session (wechat user): $DBUS_SESSION_BUS_ADDRESS"

# ============================================
# Mute desktop audio (Pulse null sink + stub paplay/aplay)
# ============================================
if [[ "${COCOCAT_DUNST_SOUND:-0}" != "1" ]]; then
  bash /opt/tools/mute-desktop-audio.sh
fi

# ============================================
# Start fluxbox window manager
# ============================================
if command -v fluxbox >/dev/null 2>&1; then
  su -s /bin/bash -c "DISPLAY=$DISPLAY DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS HOME=$WECHAT_HOME PATH=$COCOCAT_DESKTOP_PATH PULSE_SINK=$PULSE_SINK LIBCANBERRA_CACHE_ONLY=1 fluxbox &" wechat
fi

# ============================================
# Start notification daemon (prevents crash on incoming messages)
# ============================================
if command -v dunst >/dev/null 2>&1; then
  mkdir -p "$WECHAT_HOME/.config/dunst"
  if [[ -f /opt/cococat/dunstrc ]]; then
    cp /opt/cococat/dunstrc "$WECHAT_HOME/.config/dunst/dunstrc"
  elif [[ "${COCOCAT_DUNST_SOUND:-0}" != "1" ]]; then
    cat >"$WECHAT_HOME/.config/dunst/dunstrc" <<'DUNST'
[global]
    always_run_script = false
DUNST
  fi
  su -s /bin/bash -c "DISPLAY=$DISPLAY DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS HOME=$WECHAT_HOME PATH=$COCOCAT_DESKTOP_PATH PULSE_SINK=$PULSE_SINK LIBCANBERRA_CACHE_ONLY=1 dunst -config \"$WECHAT_HOME/.config/dunst/dunstrc\" &" wechat
fi

# ============================================
# Start accessibility daemon as wechat user
# ============================================
if [ -x /usr/libexec/at-spi-bus-launcher ]; then
  su -s /bin/bash -c "DISPLAY=$DISPLAY DBUS_SESSION_BUS_ADDRESS=$DBUS_SESSION_BUS_ADDRESS HOME=$WECHAT_HOME PATH=$COCOCAT_DESKTOP_PATH PULSE_SINK=$PULSE_SINK /usr/libexec/at-spi-bus-launcher &" wechat
  sleep 1  # Give AT-SPI time to register
fi

# ============================================
# Start VNC (internal only, accessed via noVNC)
# ============================================
if [ "${ENABLE_VNC:-1}" = "1" ]; then
  # Kill stale x11vnc (old images used -listen 127.0.0.1 which breaks RFB handshake).
  pkill x11vnc 2>/dev/null || true
  sleep 0.5
  # -nopw: auth enforced by agent-server /vnc/ proxy (full token)
  # -threads + -noscr: avoid x11vnc spinning on Xvfb without accepting clients
  # Do NOT use -listen 127.0.0.1 (breaks RFB handshake on libvncserver)
  x11vnc -display "$DISPLAY" -forever -nopw -shared -xkb -rfbport 5900 \
    -threads -noxdamage -noxfixes -noscr -noxrecord -nowf -defer 10 -wait 40 &
fi

# ============================================
# Start noVNC (browser-based VNC via websockify)
# ============================================
if [ "${ENABLE_VNC:-1}" = "1" ] && [ -d /opt/novnc ]; then
  NOVNC_PORT="${NOVNC_PORT:-6080}"
  pkill -f "websockify.*${NOVNC_PORT}" 2>/dev/null || true
  sleep 0.5
  # websockify on localhost only — accessed via agent-server's /vnc/ proxy (with full token auth)
  websockify --web /opt/novnc 127.0.0.1:"$NOVNC_PORT" 127.0.0.1:5900 &
  AGENT_PORT="${AGENT_PORT:-6174}"
  echo "noVNC: http://localhost:$AGENT_PORT/vnc/?token=<your-token>&autoconnect=true"
fi


# ============================================
# Launch WeChat once � the agent-server health monitor handles restarts
# Use bash so dev-mode bind-mount of docker/tools (often non-executable) still works
bash /opt/tools/launch-wechat &

# ============================================
# Initialize data directory
# ============================================
DB_PATH="${AGENT_DB_PATH:-/data/agent.db}"
if [ ! -f "$DB_PATH" ]; then
  echo "Initializing database at $DB_PATH..."
  mkdir -p "$(dirname "$DB_PATH")"
  chown wechat:wechat "$(dirname "$DB_PATH")"
fi

# ============================================
# Start agent-server (Rust binary, foreground)
# ============================================
echo "Starting agent-server on port ${AGENT_PORT:-6174}..."

# Run in a restart loop so `pkill agent-server` restarts it
# (used by dev-deploy/dev-watch to hot-swap the binary)
while true; do
  /opt/agent-server/agent-server &
  SERVER_PID=$!
  wait $SERVER_PID
  EXIT_CODE=$?
  # Exit cleanly on SIGTERM (container shutdown)
  if [ $EXIT_CODE -eq 143 ]; then
    exit 0
  fi
  echo "agent-server exited ($EXIT_CODE), restarting in 1s..."
  sleep 1
done
