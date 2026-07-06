# CocoCat

微信 AI 伙伴（可可猫）：**Driver**（容器）+ **Agent**（宿主机）+ **Wiki** + **Memory**，统一由 **CocoCat Console** 桌面应用运维。

## 文档

- [CONTEXT.md](./CONTEXT.md) — 术语
- [docs/PLAN-merge-cococat.md](./docs/PLAN-merge-cococat.md) — 合并与 Console（M1–M3）
- [docs/PLAN-humanize.md](./docs/PLAN-humanize.md) — 拟人化与记忆
- [docs/PLAN-agent-queue.md](./docs/PLAN-agent-queue.md) — 队列、防连发、thoughtful、Cron

## 快速开始

### Debian / macOS

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

### Windows 简洁部署

前置依赖：Docker Desktop、Node.js 22+。

```powershell
cd Wechat-Cococat
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1 -BuildImage
.\start-cococat.cmd
```

如果发布包内已带 Docker 镜像 tar，可用：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1 -ImageTar .\agent-wechat-amd64.tar
```

查看/停止栈：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\cococat-stack.ps1 status all
powershell -ExecutionPolicy Bypass -File .\scripts\cococat-stack.ps1 stop all
```

### Windows 正式安装器

#### 产出安装器

发布 tag `cococat-v*` 或手动运行 GitHub Actions 的 **Console Bundle** workflow，会产出：

- `cococat-console-windows`：Windows NSIS / MSI 安装器
- `cococat-console-linux`：Linux bundle

Windows 安装器负责安装 CocoCat Console，并随包带上 runtime 资源：`docker-compose.yml`、Windows bootstrap 脚本、配置模板，以及已 `pnpm deploy --prod` 的 Agent 运行包和生产依赖。安装后不需要保留源码目录。

本地打包 Console 安装包：

```bash
pnpm install
pnpm console:bundle
```

`pnpm console:bundle` 会先生成 `apps/console/src-tauri/runtime/`，再执行 Tauri 打包；该 runtime 目录是构建产物，不提交到 git。打包产物位于：

```text
apps/console/src-tauri/target/release/bundle/
```

#### Win11 安装使用

前置依赖：

- Docker Desktop，安装后保持运行
- Node.js 22 LTS 或更新版本
- Driver 镜像 `agent-wechat:amd64`，可现场构建或离线导入

安装流程：

1. 运行 `CocoCat_*_x64-setup.exe` 或 `.msi` 安装 CocoCat Console。
2. 打开 CocoCat Console，进入服务页查看“运行时就绪检查”。
3. 如果缺 Docker 或 Node，按提示安装后重新打开 Console。
4. 如果缺 Driver 镜像，使用源码/发布包中的 bootstrap 脚本准备镜像。

有源码目录时，可现场构建镜像：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1 -BuildImage
```

有离线镜像包时，导入镜像：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1 -ImageTar .\agent-wechat-amd64.tar
```

完成后重新打开 CocoCat Console，在服务页启动 Driver / Memory / Agent。

查看/停止运行栈：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\cococat-stack.ps1 status all
powershell -ExecutionPolicy Bypass -File .\scripts\cococat-stack.ps1 stop all
```

配置目录：Unix/macOS `~/.config/cococat/`，Windows `%APPDATA%\CocoCat\`

数据目录：Unix/macOS `~/.local/share/cococat/`，Windows `%LOCALAPPDATA%\CocoCat\`

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
