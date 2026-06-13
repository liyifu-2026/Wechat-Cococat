#!/usr/bin/env bash
# Route all desktop audio to a null sink and stub common sound players.
# WeChat / libnotify play sounds via PulseAudio or paplay — not via dunst 1.5.
set -euo pipefail

WECHAT_HOME="${WECHAT_HOME:-/home/wechat}"
COCOCAT_BIN="/opt/cococat/bin"

mkdir -p "$WECHAT_HOME/.config/pulse"

if [[ "${COCOCAT_DUNST_SOUND:-0}" != "1" ]]; then
  cat >"$WECHAT_HOME/.config/pulse/default.pa" <<'PA'
# CocoCat — discard all audio inside the container desktop.
load-module module-null-sink sink_name=silent sink_properties=device.description=silent
set-default-sink silent
set-default-source silent.monitor
PA
fi

if command -v pulseaudio >/dev/null 2>&1; then
  su -s /bin/bash wechat -c "
    pulseaudio --kill 2>/dev/null || true
    sleep 0.2
    pulseaudio --start --exit-idle-time=-1 --log-target=syslog 2>/dev/null || true
    sleep 0.4
    if command -v pactl >/dev/null 2>&1; then
      pactl load-module module-null-sink sink_name=silent sink_properties=device.description=silent 2>/dev/null || true
      pactl set-default-sink silent 2>/dev/null || true
      pactl set-sink-mute silent 1 2>/dev/null || true
      pactl set-sink-volume silent 0 2>/dev/null || true
    fi
  " || true
fi

export COCOCAT_PULSE_SINK="${COCOCAT_PULSE_SINK:-silent}"
