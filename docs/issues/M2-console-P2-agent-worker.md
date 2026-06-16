# [M2 · Console] Phase 2 — Agent 长驻 Worker（Preview / Try Ask 冷启动清零）

> **类型：** Performance · Internal data plane  
> **状态：** ✅ 已落地  
> **依赖：** Phase 0（Rust Hub IPC / 事件扇出）可选；`pnpm --filter @cococat/agent build`  
> **关联：** Phase 6.1 分流静默升级（`deflectLine` 移除 → preview 探针问题返回 `reply` 而非 `deflect`）

---

## 背景

Console 内 **AI 辅助 / Brain Try Ask / Preview** 原先每次调用 `preview_agent_reply` 都会 `Command::new("node")` 冷启动脚本，首字延迟常在 **1–3s**。Phase 0 已将健康探活、Driver REST、WebSocket 收拢进 Rust Hub；Phase 2 将 Agent 预览逻辑同样长驻化，目标 **warm 路径 <200ms**（实测 ping/preview ~140ms）。

---

## 目标

| 指标 | 目标 |
|------|------|
| Preview 首包（Worker 已 warm） | < 200ms |
| 冷启动 Node 次数 | Try Ask / Preview 路径为 **0**（fallback 除外） |
| stdout 污染 | **0** — 仅单行 JSON-RPC |
| 孤儿 Node 进程 | Tauri 退出或 stdin 关闭后 **5ms 内** exit |

---

## 架构设计令牌（硬红线）

### 1. 管道绝对纯净（Pure Channel Guard）

- 跨平台 **Framed Stdio**：一行一个 JSON 对象 + `\n`
- Node 入口 **劫持 `console.*`** → 全部写 `stderr`
- `stdout.write` 保留给 RPC 响应帧；Rust 侧 `serde_json` 按行解析

### 2. 孤儿进程连带自杀（Orphan Suicide Protection）

- Node：`process.stdin.on("close")` → `process.exit(0)`
- Rust：`RunEvent::Exit` → `agent_worker::shutdown()`（kill + wait）
- 不依赖进程树扫描

### 3. 并发阻尼与请求路由（Concurrent Queue & Lock）

- Rust：`tokio::sync::Mutex`（`REQUEST_SERIAL`）串行化 RPC 写锁
- 后台线程读 `stdout`，`HashMap<id, oneshot>` 多路复用响应
- Worker 死亡：`try_wait()` 检测 → 自动 respawn
- Worker 不可用：静默 **fallback** 到 `node scripts/preview-agent-reply.mjs`

---

## 数据流

```
WebView  invoke("preview_agent_reply")
    ↓
preview_reply.rs  →  agent_worker::request_preview_reply (async)
    ↓
spawn_blocking + REQUEST_SERIAL
    ↓
stdin  {"id", "method":"preview_reply", "params":{query, chatId?}}\n
    ↓
packages/agent/dist/worker-entry.js --worker
    ↓
previewCustomerReply({ query, chatId })
    ↓
stdout  {"id", "result":{...}, "error":null}\n
    ↓
PreviewReplyResult → WebView
```

---

## 核心文件

| 模块 | 路径 | 职责 |
|------|------|------|
| Node RPC 端 | `packages/agent/src/worker-entry.ts` | `--worker` 模式；`preview_reply` / `ping` |
| Rust 守护 | `apps/console/src-tauri/src/agent_worker.rs` | spawn / shutdown / request / 串行锁 |
| Tauri 命令 | `apps/console/src-tauri/src/preview_reply.rs` | Worker 优先 + cold fallback |
| 生命周期 | `apps/console/src-tauri/src/lib.rs` | setup 预热；Exit 收割 |

---

## RPC 协议

**请求（Rust → Node，stdin）：**

```json
{"id":1,"method":"preview_reply","params":{"query":"你好","chatId":"wxid_..."}}
```

**响应（Node → Rust，stdout）：**

```json
{"id":1,"result":{"action":"reply","gate":"continue",...},"error":null}
```

**错误：**

```json
{"id":1,"result":null,"error":"preview_reply requires params.query"}
```

支持方法：`preview_reply`、`ping`。

---

## 验收标准

- [x] Console 启动后后台 `ensure_spawned()` 预热 Worker
- [x] Brain Try Ask / AI 辅助 Preview 走 Worker RPC（非每次 spawn）
- [x] Worker ping 集成测试通过（`cargo test worker_ping`）
- [x] 手动 ping / preview ~140ms（dist 已 build）
- [x] Worker 失败时 fallback 冷启动，功能不回归
- [x] `RunEvent::Exit` 无残留 Node 进程
- [x] 单测对齐 Phase 6.1：`你是不是机器人` → `action: reply`（非 `deflect`）

---

## 构建与调试

```bash
pnpm --filter @cococat/agent build

# 手动 Worker 探活
printf '%s\n' '{"id":1,"method":"ping","params":{}}' \
  | node packages/agent/dist/worker-entry.js --worker

# Rust 测试
cd apps/console/src-tauri && cargo test worker_ping
```

环境变量：`COCOCAT_NODE` 可覆盖 node 二进制路径；`COCOCAT_REPO_ROOT` 由 Rust spawn 时注入。

---

## 后续路线（内部加速）

| Phase | 方向 | 概要 |
|-------|------|------|
| **Phase 1** | Wiki API 库化 | `:19828` 抽 `@cococat/wiki-core`，Agent 直调，UI 侧端口隐形 |
| **Phase 3** | Stack 原生守护 | 替代 `stack_command` bash；Rust 管理 `*.pid` 与子进程生命周期 |

---

## 非目标（本票不做）

- Try Ask / AI 辅助以外的 Agent queue worker 长驻（仍由 stack 管理）
- Worker 内多 method 并发（当前串行足够 Preview 场景）
- 跨会话请求丢弃/合并策略（后续按需）
