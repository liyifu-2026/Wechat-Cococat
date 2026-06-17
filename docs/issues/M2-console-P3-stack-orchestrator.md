# [M2 · Console] Phase 3 — Stack 原生守护管理（Zero-Shell Orchestrator）

> **类型：** Infrastructure · Process lifecycle  
> **状态：** ✅ 已落地（Console Tauri 路径）  
> **依赖：** Phase 0 健康快照、Phase 2 Agent Worker  
> **保留：** `scripts/cococat-stack.sh` 仍供 CI / 终端 CLI 使用

---

## 背景

Console 启停栈原先通过 `bash scripts/cococat-stack.sh` 间接管理 driver（Docker）、memory（TencentDB gateway）、agent（Node CLI）。GUI 环境下常见 **`PATH` 丢失**（找不到 node/pnpm）、Bash 解释开销、以及 PID 文件与僵尸进程不同步。

Phase 3 在 Rust 侧实现 **StackOrchestrator**，Tauri `stack_command` 直接原生 spawn / 探活 / 收割，实现 Zero-Shell 主路径。

---

## 目标

| 指标 | 目标 |
|------|------|
| Console `stack_command` | **零 bash** 转发 |
| Node 发现 | 显式候选路径 + `COCOCAT_NODE` + nvm 扫描 |
| PID 文件 | 原子写 + 启动前僵尸清理 |
| App 退出 | 级联 SIGTERM → SIGKILL + docker compose down |

---

## 架构设计令牌（硬红线）

### 1. 原子 PID 写锁与孤儿清理

- 写入 `{name}.pid.tmp` → `rename` 至 `{name}.pid`
- 启动前 `kill(pid, 0)` 探活；死 PID 文件自动删除
- 强杀残留：`SIGTERM` 500ms → `SIGKILL`

### 2. 裸 Spawn 策略（Sanitized PATH）

`stack::node_path_env()` 补全：

- `~/.local/bin`、`~/.local/share/cococat/bin`
- `/opt/homebrew/bin`、`/usr/local/bin`
- monorepo `node_modules/.bin`
- nvm 最新 node

`find_node_binary()` 顺序：`COCOCAT_NODE` → `which node` → 硬编码候选。

### 3. 级联收割（Teardown Chain）

`RunEvent::Exit` 与 `shutdown_all()`：

1. stop agent（PID）
2. stop memory（gateway.pid + memory.pid）
3. stop driver（`docker compose down` + stop agent-wechat）

---

## 服务矩阵

| 服务 | 启动 | 探活 | 停止 |
|------|------|------|------|
| **driver** | docker compose up / start 现有容器 | HTTP `6174/api/status` | compose down |
| **memory** | `node --import tsx/esm gateway/server.ts` | HTTP `8420/health` | SIGTERM gateway |
| **agent** | `node packages/agent/dist/cli.js` | PID + kill -0 | SIGTERM agent |

PID 目录：`~/.local/share/cococat/stack/*.pid`

---

## 核心文件

| 模块 | 路径 |
|------|------|
| 原生编排器 | `apps/console/src-tauri/src/stack_orchestrator.rs` |
| PATH / token 工具 | `apps/console/src-tauri/src/stack.rs` |
| 生命周期 | `apps/console/src-tauri/src/lib.rs`（Exit → `shutdown_all`） |

---

## API 不变

前端仍调用：

```typescript
invoke("stack_command", { service: "driver"|"memory"|"agent"|"all", action: "start"|"stop"|"status" })
```

输出文本格式与 bash 脚本兼容（`driver: up (...)` 等）。

---

## 验收标准

- [x] `stack_command` 不再 spawn bash/cococat-stack.sh
- [x] `extended_path` 含 homebrew / cococat bin
- [x] PID 原子写单测通过
- [x] env 文件解析单测通过
- [x] App Exit 调用 `stack_orchestrator::shutdown_all`
- [ ] 生产打包实机启栈 QA（需用户环境）

---

## 非目标（本票不做）

- 删除 `scripts/cococat-stack.sh`（CI / 终端仍用）
- Linux `sg docker` 权限降级回退（docker 失败时仍报错提示）
- Memory gateway `npm install` 自动安装（仍须预先 clone + install）
- Windows 原生 docker/agent 路径（Unix 优先）

---

## 调试

```bash
# 状态（经 Tauri 或单元逻辑）
cd apps/console/src-tauri && cargo test stack_orchestrator

# 显式 node
COCOCAT_NODE=/usr/local/bin/node pnpm console:dev
```
