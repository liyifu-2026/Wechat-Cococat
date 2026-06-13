# @cococat/agent

WeChat channel for [**pi**](https://github.com/earendil-works/pi) — **CocoCat Agent**，宿主机运行，通过 REST + WebSocket 驱动容器内 Driver。

## Prerequisites

- Driver 容器已启动（`pnpm stack start driver` 或 `docker compose up -d`）
- Token：`~/.config/cococat/token`
- Node.js >= 22
- LLM API key（如 `ANTHROPIC_API_KEY`）
- **队列模式（推荐）**：Redis（`docker compose up -d redis` 或自带实例）

## Run

```bash
cd Wechat-Cococat
pnpm install
pnpm migrate    # 从 agent-wechat 升级时
pnpm agent:build
pnpm agent
```

### 子命令

```bash
# 从微信 DB 全量重建 transcript（单 chat 或全部）
pnpm agent reconcile-transcript <chatId>
pnpm agent reconcile-transcript --all
pnpm agent:reconcile --all   # 根目录便捷脚本
```

## Configuration

复制 [`config/agent.env.example`](../../config/agent.env.example) → `~/.config/cococat/agent.env`（`cococat-stack start agent` 会自动 source）。

### 连接与模型

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENT_WECHAT_URL` | `http://localhost:6174` | Driver base URL |
| `AGENT_WECHAT_TOKEN` | token file | Bearer auth |
| `PI_PROVIDER` | `anthropic` | pi-ai provider id |
| `PI_MODEL` | `claude-sonnet-4-20250514` | Model id |

### 群 @ 与 Wiki

| Variable | Default | Description |
|----------|---------|-------------|
| `BRIDGE_GROUPS_CONFIG` | `~/.config/cococat/bridge-groups.json` | Per-group @ rules |
| `BRIDGE_REPLY_WITH_MENTION` | `none` | 出站 @：`none` / `trigger` / `all` |
| `WIKI_ENABLED` | off | Enable Wiki tools |
| `WIKI_API_URL` | `http://127.0.0.1:19828` | CocoCat Wiki API |

### 队列（BullMQ + Redis）

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | — | 设置后默认启用队列，如 `redis://127.0.0.1:6379` |
| `QUEUE_ENABLED` | 随 `REDIS_URL` | `true` / `false` 显式开关 |
| `QUEUE_CONCURRENCY` | `4` | inbound worker 并发 |

未启用队列时，消息仍由 `ChatSession.process()` **同步**处理。

### 回复节奏与记忆

| Variable | Default | Description |
|----------|---------|-------------|
| `WECHAT_PI_HISTORY_LIMIT` | `40` | transcript 条数 |
| `WECHAT_REPLY_COOLDOWN_MS` | `30000` | 自动回复后冷却（可被 per-chat `style.json` 覆盖） |
| `CAPTION_TAIL_WINDOW` | `10` | hydrate 时尾部媒体 caption 兜底比对条数 |

Per-chat `~/.local/share/cococat/chats/{id}/style.json` 支持：`replyCooldownMs`、`maxSendsPerTurn`、`replyMode`（`fast` | `thoughtful`）、`thoughtfulAck`、`thoughtfulReflect`、`replyDelayMs`、`burstDelayMs`。

Agent 工具：`wechat_send_message`（文字）、`wechat_send_image`（图片/表情，参数 `localId` 或 `path`）、`wechat_list_messages`。

### 定时主动消息

复制 [`data/schedules.json.example`](../../data/schedules.json.example) → `~/.config/cococat/schedules.json`。需启用队列。

## Architecture

```
Host: @cococat/agent (pi-agent-core)
  ↕ WS + REST (+ Redis/BullMQ when enabled)
Container: @cococat/driver (FSM + DB)
  ↕ UI automation
WeChat desktop
```

容器内 **不跑 LLM**。

- 拟人化与记忆：[`docs/PLAN-humanize.md`](../../docs/PLAN-humanize.md)
- 队列、防连发、thoughtful、Cron：[`docs/PLAN-agent-queue.md`](../../docs/PLAN-agent-queue.md)

## Escalation（私聊分流 / 维护者）

复制 [`escalation.json.example`](../../escalation.json.example) 到 `~/.config/cococat/escalation.json`，填写维护者 `chatId`（可用 `wx contacts find` 解析）。

维护者微信指令：`列表` / `已处理` / `解除`。Console → Agent → **分流** Tab 可图形配置。

可选 `triage.useLlm: true` 启用小模型分流；`notifyOn.lowConfidence: true` 启用低置信 FYI（不 mute）。详见 [`docs/PLAN-escalation.md`](../../docs/PLAN-escalation.md)。
