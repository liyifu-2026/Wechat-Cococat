# CocoCat

微信 AI 伙伴（可可猫）：**Driver**（容器）+ **Agent**（宿主机）+ **Wiki** + **Memory**，统一由 **CocoCat Console** 桌面应用运维。

## 文档

- [CONTEXT.md](./CONTEXT.md) — 术语
- [docs/PLAN-merge-cococat.md](./docs/PLAN-merge-cococat.md) — 合并与 Console（M1–M3）
- [docs/PLAN-humanize.md](./docs/PLAN-humanize.md) — 拟人化与记忆
- [docs/PLAN-agent-queue.md](./docs/PLAN-agent-queue.md) — 队列、防连发、thoughtful、Cron

## 快速开始

```bash
cd Wechat-Cococat
pnpm install

# 从旧 agent-wechat 升级时必跑
pnpm migrate

pnpm build:image
pnpm stack start all   # Driver + Redis（队列模式）
pnpm console:dev

# 可选：显式启用 BullMQ 入站
export REDIS_URL=redis://127.0.0.1:6379
pnpm agent
```

打包 Console 安装包：`pnpm console:bundle`（或 tag `cococat-v*` 触发 CI）。

配置目录：`~/.config/cococat/` · 数据：`~/.local/share/cococat/`  
Agent 环境模板：[`config/agent.env.example`](./config/agent.env.example)（含 `REDIS_URL` 队列）

## Monorepo 布局（M3）

| 路径 | npm 包 | 说明 |
|------|--------|------|
| `apps/console/` | `@cococat/console` | CocoCat Console（Tauri） |
| `packages/agent/` | `@cococat/agent` | CocoCat Agent |
| `packages/driver/` | `@cococat/driver` | Rust channel driver |
| `packages/cli/` | `@cococat/cli` | `wx` CLI |
| `packages/shared/` | `@cococat/shared` | 共享类型 |
| `scripts/cococat-stack.*` | — | 一键启停栈 |

## Console 模块

| 模块 | 功能 |
|------|------|
| **Wiki** | 知识库编辑 + `:19828` API |
| **WeChat** | 登录 QR、只读消息、VNC |
| **Agent** | persona、per-chat、群 @ 策略 |
| **Memory** | L0/L1 摘要、recall、L3 预览 |
| **栈** | 启停 Driver/Memory/Agent |
