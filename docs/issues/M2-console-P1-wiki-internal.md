# [M2 · Console] Phase 1 — Wiki API 内部库化与条件启动

> **类型：** Performance · Security · Internal data plane  
> **状态：** ✅ 已落地  
> **依赖：** Phase 2 Agent 长驻 Worker（双向 stdio RPC）  
> **关联：** [M2·P1 联邦检索](M2-console-P1-ai-assist-per-chat-wiki.md)、[Phase 2 Agent Worker](M2-console-P2-agent-worker.md)

---

## 背景

Agent `WikiClient` 原先每次检索都走 `http://127.0.0.1:19828`，链路为：

**WebView → Worker → HTTP → tiny_http → Rust search → FS**

Console UI 本身已走 Tauri `invoke("search_project")` 直连 Rust，但 Agent 路径仍依赖常驻 HTTP 端口。Phase 1 在 Worker 模式下斩断 HTTP，改为 **Worker → 上游 stdio RPC → Rust 联邦检索 → FS**。

---

## 目标

| 指标 | 目标 |
|------|------|
| Worker 模式 Wiki 检索 | **零 TCP**（stdio 帧 + Rust 直调） |
| 生产默认 | `:19828` **不 bind**（stealth） |
| 联邦路径 | 保持 `{ projectPath, relPath, title }` 显式结构 |
| 开发/外部脚本 | `COCOCAT_DEV_API=1` 或设置页显式开启 API |

---

## 架构设计令牌（硬红线）

### 1. 零网络本地直调（Zero-Network Function Invocation）

- Worker 启动时注入 `COCOCAT_WIKI_INTERNAL=1`
- `wiki-client.ts` 检测内部模式 → `wiki-rpc.ts` → stdout 上游帧
- Rust `agent_worker` 读 stdout，`direction:"request"` 帧由 `wiki_internal` 处理
- 响应写回 Worker stdin（与顶层 RPC 复用同一管道，靠 `method` 字段区分方向）

### 2. 端口静默隔离（Conditional Port Stealth）

- `api_server::start_api_server` 仅在以下情况 bind `:19828`：
  - `COCOCAT_DEV_API=1`，或
  - `app-state.json` → `apiConfig.enabled === true`
- 默认 `apiConfig.enabled: false`（新用户 stealth）
- `get_api_status()` 新增 `disabled` 状态

### 3. 联邦路径对齐（Path Symmetry Guard）

- Rust `search_federated_inner` + `fuse_federated_rrf`（`RRF_K=60`，与 TS 对齐）
- 出参含 `projectPath`、`relPath`、`rrfScore`、`libraryRank`、`rawScore`
- 禁止回退到全局单库猜测

---

## 双向 stdio 协议（Worker ↔ Rust）

**Node → Rust（stdout，嵌套上游请求）：**

```json
{"direction":"request","id":100,"method":"wiki_search_federated","params":{"query":"退款","projects":[{"projectPath":"/path/to/proj","projectName":"FAQ"}],"topK":10}}
```

**Rust → Node（stdin，上游响应）：**

```json
{"id":100,"result":[...],"error":null}
```

**支持的上游 method：**

| method | 说明 |
|--------|------|
| `wiki_search_federated` | 多库 RRF 联邦检索 |
| `wiki_read_file` | `{ projectPath, relPath }` 直读 UTF-8 |
| `wiki_list_projects` | 读 Console projectRegistry |
| `ping` | 探活 |

---

## 核心文件

| 模块 | 路径 |
|------|------|
| Wiki 内部 RPC 路由 | `apps/console/src-tauri/src/wiki_internal.rs` |
| 联邦检索 Rust 核 | `apps/console/src-tauri/src/commands/search.rs` |
| 双向 Worker 网关 | `apps/console/src-tauri/src/agent_worker.rs` |
| Node 上游传输 | `packages/agent/src/wiki-rpc.ts` |
| WikiClient 内部化 | `packages/agent/src/wiki-client.ts` |
| 条件 API 启动 | `apps/console/src-tauri/src/api_server/mod.rs` |
| 默认 stealth | `apps/console/src/stores/wiki-store.ts` |

---

## 验收标准

- [x] Worker 模式 `WikiClient.search` 不走 `fetch(:19828)`
- [x] Rust `search_federated_inner` 多库 RRF 与 TS `fuseFederatedRrf` 同 K 值
- [x] 默认启动 `:19828` 不 bind（`api_status = disabled`）
- [x] `COCOCAT_DEV_API=1` 或设置开启后 bind 正常
- [x] standalone stack Agent（非 Worker）仍可走 HTTP fallback
- [x] `cargo test` 通过（除既有 preview 业务漂移单测）

---

## 构建与调试

```bash
pnpm --filter @cococat/agent build

# 开发模式强制开启 HTTP API（供 curl / 外部编辑器）
COCOCAT_DEV_API=1 pnpm console:dev

# 检查 API 状态（Tauri invoke 或日志）
# disabled = stealth；running = 已 bind
```

---

## 非目标（本票不做）

- 新建独立 `@cococat/wiki-core` npm 包（逻辑暂留 Rust `commands/search` + `wiki_internal`）
- Console WebView `searchWikiFederated` 改 invoke（仍走现有 Tauri `search_project` 编排）
- API 设置页热启（开启后需重启 App 才 bind — 后续可补）
- `getProjectMeta` Worker 内 RPC（内部模式返回 null，Ops 走 scope 快照）

---

## 后续

- **Phase 3**：Stack 原生守护，替代 bash pid 管理
- 可选：Tauri `wiki_search_federated` command 统一 UI/Agent 语义
- 可选：API 热启监听 `apiConfig.enabled` 变更
