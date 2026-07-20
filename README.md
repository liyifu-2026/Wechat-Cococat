# CocoCat

CocoCat 是运行在微信里的 AI 伙伴。它把微信连接、对话编排、外部资料和长期记忆组合在一起，并通过统一的桌面 Console 管理。

```text
微信客户端 ← CocoCat Driver ← CocoCat Agent
                              ├─ CocoCat Wiki
                              └─ CocoCat Memory

                 CocoCat Console（配置、观察与启停）
```

## 组成

| 组件 | 位置 | 职责 |
| --- | --- | --- |
| CocoCat Console | `apps/console/` | Tauri 桌面应用；管理 Wiki、微信、Agent、Memory 和服务栈 |
| CocoCat Agent | `packages/agent/` | 对话大脑；处理消息、工具调用、persona、队列与回复策略 |
| CocoCat Driver | `packages/driver/` | Rust 微信执行与感知层；提供 REST/WebSocket API，不运行 LLM |
| CocoCat Wiki | Console Wiki 模块 | 按会话挂载和检索外部资料 |
| CocoCat Memory | Agent + Memory 服务 | 跨会话长期记忆 |
| Shared | `packages/shared/` | 跨包共享的类型、配置和路径约定 |
| CLI | `packages/cli/` | `wx` 命令行工具 |

术语和权威边界以 [`CONTEXT.md`](./CONTEXT.md) 为准。

## 环境要求

- Node.js 22 或更新版本
- Corepack 与 pnpm 9.15.4
- Rust stable（开发 Driver 或打包 Console 时）
- Docker Desktop / Docker Engine（运行微信 Driver 时）

启用仓库声明的 pnpm 版本：

```bash
corepack enable
corepack prepare pnpm@9.15.4 --activate
```

## 快速开始

### Linux / macOS

```bash
git clone https://github.com/liyifu-2026/Wechat-Cococat.git
cd Wechat-Cococat
pnpm install --frozen-lockfile

# 仅从旧 agent-wechat 配置升级时需要
pnpm migrate

pnpm build:image
pnpm stack start all
pnpm console:dev
```

常用栈命令：

```bash
pnpm stack status all
pnpm stack stop all
pnpm agent
```

如需显式启用 BullMQ 入站队列：

```bash
export REDIS_URL=redis://127.0.0.1:6379
pnpm agent
```

### Windows 11

前置条件：Docker Desktop 已启动，Node.js 22+ 已安装。

```powershell
git clone https://github.com/liyifu-2026/Wechat-Cococat.git
cd Wechat-Cococat
corepack enable
pnpm install --frozen-lockfile
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1 -BuildImage
.\start-cococat.cmd
```

使用离线 Driver 镜像：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-windows.ps1 `
  -ImageTar .\agent-wechat-amd64.tar
```

查看或停止服务：

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\cococat-stack.ps1 status all
powershell -ExecutionPolicy Bypass -File .\scripts\cococat-stack.ps1 stop all
```

## 开发

```bash
pnpm typecheck       # 全仓类型检查
pnpm build           # 构建所有 workspace
pnpm console:dev     # 启动 Console 开发环境
pnpm console:bundle  # 构建桌面安装包
pnpm build:image     # 为当前架构构建 Driver 镜像
```

单独运行包测试：

```bash
pnpm --filter @cococat/shared test
pnpm --filter @cococat/agent test
pnpm --filter @cococat/console test
cargo test --manifest-path packages/driver/Cargo.toml
```

Console 安装包生成在：

```text
apps/console/src-tauri/target/release/bundle/
```

## 仓库结构

```text
.
├── apps/
│   └── console/                 # 唯一桌面入口
├── packages/
│   ├── agent/                   # 对话编排
│   ├── driver/                  # Driver 权威 Rust 源码
│   ├── shared/                  # 共享类型与配置
│   ├── cli/                     # 命令行工具
│   ├── openclaw-extension/      # OpenClaw 集成
│   ├── wechaty-gateway/         # Wechaty 网关
│   └── wechaty-puppet/          # Wechaty Puppet
├── config/                      # 可提交的配置模板；不放密钥
├── data/                        # 示例数据
├── docker/                      # Driver 镜像定义和运行工具
├── scripts/                     # 构建、迁移、安装和栈管理脚本
├── docs/                        # 架构、计划、原型与文档站
├── tools/                       # 开发辅助工具
├── CONTEXT.md                   # 领域术语与架构边界
└── pnpm-workspace.yaml          # workspace 清单
```

`packages/driver/` 是 Driver 的唯一源码。`docker/agent-server-rust/` 由
`scripts/prepare-docker-context.sh` 在构建镜像时临时生成，不应手工修改或提交。

## 保持仓库整洁

仓库只提交源码、锁文件、配置模板和必要的跨平台运行资源。以下内容均为本地依赖、缓存或构建产物，已由 `.gitignore` 排除：

| 路径 | 内容 | 重新生成 |
| --- | --- | --- |
| `node_modules/` | pnpm 依赖 | `pnpm install --frozen-lockfile` |
| `**/dist/` | TypeScript / Vite 输出 | `pnpm build` |
| `**/target/` | Rust / Tauri 输出 | `cargo build` 或 Console 打包 |
| `.turbo/` | Turborepo 缓存 | 自动生成 |
| `docker/agent-server-rust/` | Driver Docker 构建上下文 | `scripts/prepare-docker-context.sh` |
| `docker/wechat.deb` | 本地微信安装包缓存 | `bash scripts/download-wechat.sh` |
| `apps/console/src-tauri/runtime/` | Console 打包运行时 | `pnpm console:runtime` |
| `.data/`、`wechat_files/` | 本地运行数据 | 运行时生成 |

提交前建议检查：

```bash
pnpm repo:check
git status --short
git diff --check
```

`pnpm repo:check` 同样在 CI 中执行，防止依赖、构建输出、本地运行数据或真实
`.env` 被重新提交。

不要提交真实 `.env`、Token、API Key、聊天数据或微信安装包。配置请从
[`config/`](./config/) 中的 `*.example` 文件复制到用户配置目录：

- Linux / macOS：`~/.config/cococat/`
- Windows：`%APPDATA%\CocoCat\`

运行数据默认位于：

- Linux / macOS：`~/.local/share/cococat/`
- Windows：`%LOCALAPPDATA%\CocoCat\`

## 文档

- [领域术语与实现参考](./CONTEXT.md)
- [Agent 与 Driver API](./AGENT.md)
- [Console 合并计划](./docs/PLAN-merge-cococat.md)
- [拟人化与记忆计划](./docs/PLAN-humanize.md)
- [Agent 队列计划](./docs/PLAN-agent-queue.md)
- [文档站源码](./docs/site/)

## 发布

推送 `cococat-v*` tag 或手动运行 GitHub Actions 的 Console Bundle workflow，可生成 Windows 与 Linux Console 安装包。正式安装包会包含 Console 所需运行时资源；安装后无需保留源码目录。
