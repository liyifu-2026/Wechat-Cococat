#!/usr/bin/env bash
# 在 docs/mockups 目录启动静态服务并打印预览地址
cd "$(dirname "$0")"
PORT="${1:-8877}"
echo "Mockups: http://127.0.0.1:${PORT}/"
echo "  Wiki IA:  http://127.0.0.1:${PORT}/console-system-wiki-ia.html"
echo "  Console v2: http://127.0.0.1:${PORT}/console-ui-v2.html"
exec python3 -m http.server "$PORT" --bind 127.0.0.1
