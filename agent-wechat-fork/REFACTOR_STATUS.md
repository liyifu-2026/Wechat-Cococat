# agent-wechat 重构记录

## 已完成的架构重构

（历史条目见 git log；bridge 已拆分为 mod / chat_processor / coordinator / poller / scheduler / login_guard 等子模块。）

---

## 当前问题与处理状态

### 1. `login_guard` 启动时 a11y 阻塞 — **已缓解**

**现象**：`should_skip_login_trigger()` 调 `get_a11y_desktop()` 可能卡住，且原先在 `spawn_bridge()` 里 `await trigger_login()`，会推迟 HTTP 6174 监听。

**已做**：
- `login_guard`：a11y 校验 `timeout(5s)`，超时信任缓存
- `bridge/mod.rs`：`trigger_login` 改为 `tokio::spawn`，**不再阻塞** `spawn_bridge` 返回
- `extract_keys_async`：传入 session 的 `DISPLAY` / `DBUS_SESSION_BUS_ADDRESS`

**仍待容器内验证**：AT-SPI 在启动瞬间未就绪的根因（可用 REFACTOR_STATUS 原附的 docker exec 命令测）

### 2. 容器内热部署脆弱 — **已改进脚本**

**已做**：
- `scripts/dev-deploy.sh`：源码路径改为 `agent-server-rust/`（非过期的 `packages/`）
- 部署流程：`agent-server.new` → `TERM` 停进程 → `mv` 原子替换（避免 Text file busy）
- `pkill` 使用 `-x agent-server` / 精确路径，避免误杀 bash

**推荐生产路径**（不变）：
```bash
./scripts/build-images-local.sh --release
# 用新镜像启动容器，挂载原 data volume
```

### 3. Bridge 群回复 @人 — **已实现（Bridge 路径）**

**根因**：Bridge 自动回复调用 `send_wechat_message` 时 `mentions` 恒为空，FSM 跳过 Mentioning 阶段。

**已做**（`agent-server-rust` Bridge + FSM）：
- `chat_processor.rs`：群聊回复经 `policy::resolve_reply_mentions` + `mention_names` 解析昵称，传入 `send_wechat_message`
- `send_wechat_message`：接受 `mentions` 参数，交给 `SendMessagePlan` Mentioning 阶段
- `mention_names.rs`：优先群昵称（nick > remark），支持从正文 `@Name\u2005` 解析
- `config.rs` + `policy.rs`：`BRIDGE_*` 环境变量 + `/data/bridge-groups.json` 按群覆盖
- `group_buffer.rs`：`requireMention` 时未 @ 消息缓冲，@ 时注入上下文
- `send_message.rs`：Mentioning 失败 3 次后降级纯文本发送
- `wechat_messages.rs`：修复 `atuserlist` wxid 匹配；群消息 sender 优先 nick_name

**配置示例**（复制到 volume `/data/bridge-groups.json`）见 `data/bridge-groups.json.example`

| 环境变量 | 默认 | 含义 |
|---------|------|------|
| `BRIDGE_REQUIRE_MENTION` | `true` | 群聊必须 @ 才回复 |
| `BRIDGE_REPLY_WITH_MENTION` | `true` | `true` / `false` / `all` |
| `BRIDGE_GROUPS_CONFIG` | `/data/bridge-groups.json` | 按群策略 |
| `BRIDGE_GROUP_HISTORY_LIMIT` | `50` | 群缓冲条数 |

**验收步骤**：
1. `./scripts/dev-deploy.ps1` 或 `./scripts/dev-deploy.sh --release`
2. 群内 @ 机器人 → 日志应有 `reply mentions: ["你的昵称"]`，微信回复带 @
3. 未 @ 发消息 → 日志 `buffered N group message(s)`，不回复
4. @ 后 → 缓冲消息作为上下文一并处理

```powershell
docker logs agent-wechat -f 2>&1 | Select-String "reply mentions|buffered|Mentioning|mention fallback|Sent:"
```

### 4. `message_0.db` 损坏导致无限 extraction — **已修复**

**已做**（`wechat_keys.rs` + `session_ctx` + `events`）：
- 有 key 但 `verify_key` 打不开的 shard（如损坏的 `message_0.db`）标记为 `_skip:{db_name}` 持久化跳过
- `needs_key_extraction` 不再因「有文件但不可读」反复触发 extraction
- `mark_unopenable_shards()` 在 SessionCtx / event monitor 加载 keys 时自动扫描

**运维**：损坏文件可手动 `mv message_0.db message_0.db.corrupt`，由 WeChat 重建；agent 侧不再死循环。

---

## 下一步

1. `./scripts/build-images-local.sh --release` 或 `./scripts/dev-deploy.sh --release`
2. 验证：登录 → 6174 健康 → 群聊 @ 机器人 → 回复是否 @ 触发者（见 §3 验收步骤）
3. 容器内跑 a11y-dump 启动探测，确认 5s 内可返回

## 本地验证（2025-06）

```bash
cd agent-server-rust
cargo test --lib bridge:: wechat_keys::   # 7 passed
cargo test --test fsm_tests               # 8 passed
cargo test --lib                        # 47 passed; 1 flaky mimo mock HTTP test may fail offline

cd ../packages/openclaw-extension
pnpm test                               # access-control + replyWithMention tests
```

---

## 文件变更清单（本轮修复）

| 文件 | 说明 |
|------|------|
| `agent-server-rust/src/bridge/mod.rs` | login 非阻塞 spawn |
| `agent-server-rust/src/bridge/login_guard.rs` | a11y timeout 5s |
| `agent-server-rust/src/tools/wechat_keys.rs` | skip 损坏 shard、session dbus |
| `agent-server-rust/src/context/session_ctx.rs` | mark_unopenable_shards |
| `agent-server-rust/src/events.rs` | 同上 |
| `scripts/dev-deploy.sh` | 正确源码路径 + 安全热替换 |
| `scripts/build-images-local.sh` | 从 `agent-server-rust/` 复制构建上下文 |
| `agent-server-rust/src/bridge/chat_processor.rs` | 群 @ 门控、缓冲、mentions 发送 |
| `agent-server-rust/src/bridge/config.rs` | Bridge 群策略配置 |
| `agent-server-rust/src/bridge/policy.rs` | requireMention / replyWithMention |
| `agent-server-rust/src/bridge/group_buffer.rs` | 群历史缓冲 |
| `agent-server-rust/src/bridge/mention_names.rs` | @ 昵称解析 |
| `agent-server-rust/src/agent/tools.rs` | send_wechat_message 接 mentions |
| `agent-server-rust/src/plans/send_message.rs` | Mentioning 失败降级 |
| `agent-server-rust/src/tools/wechat_messages.rs` | isMentioned wxid 匹配、群 nick 优先 |
| `data/bridge-groups.json.example` | 群策略配置示例 |
