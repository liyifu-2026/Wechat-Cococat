# [M2 · Console] Phase 0 — Rust Hub（健康 / Driver 代理 / WS 事件桥）

> **类型：** Performance · IPC  
> **状态：** ✅ 已落地  
> **后续：** Phase 2 Worker、Phase 1 Wiki、Phase 3 Stack

---

## 目标

将 WebView 侧高频 localhost HTTP / bash 探活 / 裸 WS 收拢进 Tauri Rust 进程：

| 子阶段 | 模块 | 能力 |
|--------|------|------|
| 0.1 | `health.rs` | `get_stack_health_snapshot` — 并行探活 + 3s TTL |
| 0.2 | `driver_proxy.rs` | `driver_fetch` — JSON REST 走 invoke |
| 0.3 | `event_bridge.rs` | Driver WS → `driver://event/*` Tauri Event |

---

## 硬红线

1. **大 payload 分流**：avatar/media/screenshot 仍走 `plugin-http`；JSON 走 invoke
2. **WS 健康耦合**：Driver down 时 bridge 静默睡眠 3s，指数退避至 16s
3. **Token 缓存**：`read_cococat_token_cmd` 刷新 `driver_proxy` RwLock

---

## 核心文件

- `apps/console/src-tauri/src/health.rs`
- `apps/console/src-tauri/src/driver_proxy.rs`
- `apps/console/src-tauri/src/event_bridge.rs`
- `apps/console/src/hooks/use-stack-health.ts` + `lib/stack-health-snapshot.ts`
- `apps/console/src/lib/driver-client.ts` + `driver-proxy-routing.ts`
- `apps/console/src/hooks/use-driver-events.ts`

---

## 验收

- [x] `cargo test` health / driver_proxy
- [x] 收件箱 JSON API 走 invoke（blob 仍 HTTP）
- [x] `listen("driver://event/new_messages")` 替代 WebView WS
