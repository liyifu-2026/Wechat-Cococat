# CocoCat

CocoCat 是微信里的 AI 伙伴（可可猫人设）；知识库与长期记忆是为聊天服务的能力，不是并列的独立产品。

## Language

**CocoCat**  
整套 WeChat AI 伙伴的产品与品牌名。  
_Avoid_: Wechat-Cococat（仅作历史目录名）、agent-wechat（实现/上游名）

**CocoCat Driver**  
连接微信 UI 的执行与感知层，不含 LLM。  
_Avoid_: agent-server（代码包名）、Bridge

**CocoCat Agent**  
宿主机上的对话大脑：编排 LLM、工具与 per-chat 状态。  
_Avoid_: pi-wechat（npm 包名）、Brain（非正式）

**CocoCat Wiki**  
按会话挂载的外部资料库；供 Agent 检索，不替代聊天 transcript 或长期记忆。  
_Avoid_: llm_wiki（目录/历史名）、知识库 App（独立产品叙事）

**CocoCat Memory**  
跨会话的长期相处记忆（偏好、事实、persona 回写）。  
_Avoid_: 把 Wiki 或 transcript 称作「记忆」

**CocoCat Console**  
统一的 Tauri 桌面应用：侧栏切换 Wiki / WeChat / Memory（及 Agent 配置）模块；对外品牌名即 **CocoCat**。  
_Avoid_: llm_wiki App、独立 Wiki 产品、多个并列桌面客户端

**Wiki module**  
CocoCat Console 内的知识库编辑与检索界面（由原 llm_wiki UI 迁入/保留）。  
_Avoid_: 单独安装的「Wiki 应用」叙事

**WeChat module**  
Console 内连接 Driver 的运维视图：状态、登录、VNC、只读会话列表；M1 不在 Console 内发消息。  
_Avoid_: 第二个微信客户端

**Agent control**  
Console 内一键启停 **CocoCat Agent**、**CocoCat Driver**、**CocoCat Memory**；按 OS 分脚本，并约定 PID/lockfile。  
_Avoid_: M1 在 Console 内手动代 Agent 发消息

**Memory module**  
Console 内 Memory 调试台：健康检查、按 chat 试 recall、capture 摘要、per-chat `## 相处记忆` **只读**预览（与 Agent 注入 SSOT 对齐）。  
_Avoid_: 在 Memory 模块直接改 L3（M1 不做）；读 sidecar 全局 `memory/persona.md` 当作 Agent 体感

**Memory SSOT**  
运行时与 Console 观测的唯一真相源：`~/.local/share/cococat/chats/{chat_id}/persona.md` 内 `## 相处记忆`。Sidecar `memory/persona.md` 仅为 TencentDB 内部 L3 快照，不代表 Agent 当前注入。`## 相处记忆` 解析仅 Rust（`extract_memory_section_body` / `read_chat_memory_summary`）；收件箱「相处要点」三态 + `openMemoryWithSession(chatId)` → 系统·高级·Memory overview。  
_Avoid_: TS 侧重复 regex 解析 persona；`syncPersonaL3` 用 sidecar 全局 persona 回写 per-chat；把「无 L3 内容」显示成「Memory 未启用」

**Wiki project**  
CocoCat Wiki 注册表中的一份外部资料库（用户自选目录 + UUID）。  
_Avoid_: 与 chat transcript 或 Memory 条目混为一谈

**Per-chat wiki mapping**  
某个微信会话允许 Agent 检索哪些 Wiki project；仅存映射，不复制 wiki 正文。  
_Avoid_: 把 mapping 文件称作 wiki 数据本身

**CocoCat config root**  
用户级配置目录：`~/.config/cococat/`（token、env、persona、bridge、wiki-registry 等）。  
_Avoid_: 新安装仍写 `agent-wechat`（仅只读兼容旧路径）

**CocoCat Config Root**  
跨包配置 seam：`@cococat/shared` 的 paths/auth/chat-id；读可回退 legacy，写仅 canonical。  
_Avoid_: 各包自管 token 路径或重复 `encodeChatDir`

**Inbound Turn Pipeline**  
CocoCat Agent 入站回合编排：`evaluateInboundGate` → `runInboundTurn` / `runThoughtfulInboundTurn`（共用 `inbound-turn-enrich`）→ `finalizeInboundTurn`（或 `finalizeProactiveTurn`）。  
_Avoid_: `fast-discard` 与 `processUnseen` 各维护一份门控副本

**Group Reply Policy**  
群 @ / buffer / outbound mention 的单一 module（`group-reply-policy`）：bridge-groups + style 覆盖 → 跳过/缓冲/解析 outbound @。  
_Avoid_: `policy.ts` + `group-buffer.ts` + `session.buildReplyMentions` 分散维护

**Escalation Decision**  
私聊 triage 的单一 interface（`escalation/decision`）：`decideCustomerEscalation` 供 runtime 与 `previewCustomerReply` 共用（含 hybrid/LLM 路径）。Console Brain 预览经 Tauri → `scripts/preview-agent-reply.mjs` → Agent，不再维护 Rust 规则副本。  
_Avoid_: 预览走纯规则、运行时走 hybrid 导致 Console 与真实行为不一致

**CocoCat data root**  
用户级数据目录：`~/.local/share/cococat/`（`chats/`、`memory/` 等）。  
_Avoid_: 与 Wiki project 正文目录混放

## Relationships

- **CocoCat Agent** 通过 REST/WS 驱动 **CocoCat Driver**，Driver 与微信 UI 交互
- **CocoCat Agent** 按 chat 调用 **CocoCat Wiki**（查资料）与 **CocoCat Memory**（recall/capture）
- **CocoCat Console** 是运维与资料维护的**唯一桌面入口**；内嵌 **Wiki module**，连接 Driver / Memory，并 **一键启停** 全套栈（Driver + Memory + Agent）
- **Wiki project** 的正文与索引归 CocoCat Wiki 管理；**Per-chat wiki mapping** 归 Agent 的 per-chat 配置
- 代码仓库采用**根 monorepo**（`apps/wiki`、`packages/agent`、`packages/driver`），历史目录名逐步废弃

## Flagged ambiguities

- 「记忆」曾混指 transcript、TencentDB、Wiki — 已区分：**短上下文**（transcript）、**长期记忆**（Memory）、**外部资料**（Wiki）
- Wiki 数据是否 per-chat 复制 — 已否定：Agent 只存 **project 映射**，资料仍在 Wiki 注册的项目目录
- 「独立 Wiki 桌面应用」— 已否定：Wiki 收进 **CocoCat Console** 的 **Wiki module**，品牌统一为 CocoCat
- 配置路径 `agent-wechat` — **M3**：仅 **`~/.config/cococat/`**；升级前运行 `pnpm migrate`
- M1 实施顺序 — **P-A**：已完成；`llm_wiki` → **`apps/console`**

---

## 实现参考（开发者）

本文档以下章节描述 monorepo 的逻辑分层与 **pi-agent 默认路径**。供开发者与 AI 助手快速理解代码结构。

## 核心角色

| 名称 | 位置 | 职责 |
|------|------|------|
| **agent-server** | 容器 [`packages/driver/`](packages/driver/) | **WeChat Channel Driver** — REST/WS + FSM + DB + UI 自动化，**无 LLM** |
| **pi-wechat** | 宿主机 [`packages/agent/`](packages/agent/) | **Agent 大脑** — [@earendil-works/pi-agent-core](https://github.com/earendil-works/pi) + WeChat tools |
| **CocoCat Console** | [`apps/console/`](apps/console/) | 统一桌面应用 + Wiki API `:19828` |

**默认形态**：容器 Driver + 宿主机 `pnpm agent` + Console 运维。

## 快速开始

```bash
cd Wechat-Cococat
pnpm install
pnpm migrate                  # 从 agent-wechat 升级时
pnpm build:image
pnpm stack start all
pnpm console:dev              # 或 pnpm agent
```

> Docker 镜像本地 tag：`agent-wechat:amd64`（容器名 `agent-wechat`）。

## 架构

```mermaid
flowchart LR
  Pi["@cococat/agent 宿主机"]
  Driver["agent-server 容器"]
  WX["WeChat"]

  Pi -->|"WS /api/ws/events\nREST"| Driver
  Driver --> WX
```

## 逻辑分层（agent-server 容器内）

| 层 | 模块 | 说明 |
|----|------|------|
| 接入 | `router/` | REST + WebSocket 入口 |
| FSM 规划 | `plans/` | 确定性 `Plan::select_action()`，无 LLM |
| 执行 | `execution/` + `ia/` + `tools/` | UI 自动化 |
| 基础设施 | `db/`, `events.rs`, `sessions/` | 数据与事件广播 |

容器内 **已移除** Bridge / AgentLoop / chatbot — 不再在容器内跑 LLM。

## pi-wechat 流程

1. `eventsSubscribe()` 或 poll 发现新消息 chat
2. `listMessages()` 拉正文
3. `pi Agent.prompt()` + WeChat tools（`wechat_send_message` 等）
4. REST `sendMessage` 经 FSM 发到 WeChat UI

## 环境变量

### 容器（driver only）

| 变量 | 说明 |
|------|------|
| `AGENT_PORT` | 默认 6174 |
| `PROXY` | 可选代理 |

### 宿主机 pi-wechat

| 变量 | 说明 |
|------|------|
| `AGENT_WECHAT_URL` | 默认 `http://localhost:6174` |
| `AGENT_WECHAT_TOKEN` | 或 `~/.config/cococat/token` |
| `PI_PROVIDER` / `PI_MODEL` | pi-ai 模型（默认 `anthropic` / `claude-sonnet-4-20250514`） |
| `WECHAT_PI_SYSTEM_PROMPT` | 可选系统 prompt |
| `WECHAT_PI_POLL_MS` | WS 兜底轮询间隔（默认 30000） |
| `BRIDGE_REQUIRE_MENTION` | 群聊需 @ 才回复（默认 `true`） |
| `BRIDGE_REPLY_WITH_MENTION` | 回复 @ 策略：`trigger` / `all` / `none` |
| `BRIDGE_GROUPS_CONFIG` | 群策略 JSON（默认 `~/.config/cococat/bridge-groups.json`） |
| `BRIDGE_GROUP_HISTORY_LIMIT` | 未 @ 群消息缓冲上限（默认 50） |
| `WIKI_ENABLED` | 启用 llm_wiki tools（`true` / `1`） |
| `WIKI_API_URL` | 默认 `http://127.0.0.1:19828` |
| `WIKI_API_TOKEN` | 可选 Bearer token |

LLM API key 使用 [pi-ai 标准 env](https://github.com/earendil-works/pi)（如 `ANTHROPIC_API_KEY`）。

## 权威源码

Fork Rust 源码：**`packages/driver/`**（CI/Docker 均以此为准）。

## 相关文档

- [`docs/PLAN-merge-cococat.md`](docs/PLAN-merge-cococat.md) — 合并与 Console 定稿
- [`docs/PLAN-humanize.md`](docs/PLAN-humanize.md) — 拟人化与记忆
- [`packages/agent/README.md`](packages/agent/README.md)
- [`AGENT.md`](AGENT.md) — FSM 与 REST API

## 术语（实现层）

| 术语 | 含义 |
|------|------|
| **FSM Plan** | `plans/` 内确定性 UI 动作选择 |
| **Channel Driver** | 即 CocoCat Driver；容器内 agent-server，不含 LLM |
| **pi-wechat** | 即 CocoCat Agent；npm 包 **`@cococat/agent`** |
