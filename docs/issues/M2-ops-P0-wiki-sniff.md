# [M2 · P0] 维护者 Ops：Wiki 嗅探（`搜` / `scope`）— 控制面双模式

**类型：** Feature · Maintainer Ops  
**优先级：** P0  
**依赖：** M1 已合入（纯指令控制面、`agent-scope` 快照、Wiki auto-bind）  
**预估：** 1–2 人日（不含 LLM Ops 闲聊路径）

---

## 背景

维护者私聊当前为 **纯指令控制面**（`列表` / `解除` / `已处理`），不走 `ChatSession`。运维在同一微信里无法 inline 验证 Wiki scope 与检索命中，只能换小号测客服线。

M2 目标：**指令优先、Wiki 客观题剥离 LLM**，维护者窗口成为移动端 Wiki 诊断终端。

---

## 目标

在 `EscalationService.handleMaintainerMessage`（或同级 Ops 路由）增加 **结构化 Wiki 指令**，**不经过 LLM**，直接调用现有 `WikiClient` / 本地 scope 快照。

| 指令 | 行为 |
|------|------|
| `scope` | 列出当前 Console 同步到的 Wiki 项目 + 各库 `purpose` / `tags`（读 `~/.local/share/cococat/wiki-scope/{id}.json`） |
| `搜 <query>` | 对默认/全部绑定库执行 `wiki_search`，回复 path + score + preview（Markdown Plain，Ops 腔） |
| `读 <alias/path>` | 可选：`wiki_read_page` 单页全文（截断 + 字符上限） |

未命中上述模式时 **不处理**（留给 P0.5 / P1 的自然语言 Ops 路径，本票不做）。

---

## 验收标准

- [ ] 维护者发 `scope` → 10s 内收到各库 purpose + tags（无快照时明确提示「先 Ingest 或 `wiki-scope-refresh`」）
- [ ] 维护者发 `搜 退款` → 返回 top-K 结果，含 score；无命中时明确「0 条」
- [ ] 上述回复 **不含** 客服腔（`deflectLine` / `customerLine` / 「亲亲」类话术）
- [ ] **不调用** 主 Agent、`wiki_search` tool 的 LLM 决策链；纯 `WikiClient` HTTP + 本地 JSON
- [ ] 与现有 `列表` / `解除` 指令 **共存**，互不干扰；仍走 `processMaintainer` 分流
- [ ] 单元测试：指令解析 + mock `WikiClient` 输出格式化（≥3 case）

---

## 实现要点

### 路由（保持 M1 安全边界）

```
维护者消息
  → 现有 pick_unmute 待选态
  → 现有 列表 / 解除 / 已处理
  → 【本票】^scope$ | ^搜\s+ | ^读\s+
  → 其它 → 仍回「可用指令：…」（P0.5 再开 LLM Ops）
```

### 代码触点

| 模块 | 改动 |
|------|------|
| `packages/agent/src/escalation/service.ts` | 扩展 `handleMaintainerMessage` |
| `packages/agent/src/ops/wiki-sniff.ts`（新） | 解析 + 格式化 + 调用 `WikiClient` |
| `packages/agent/src/session.ts` | 无改动（仍不进 ChatSession） |
| `WikiClient` | 启动时已 `syncRegistry`；搜前 `setProjectAliases` 用 Console 全库或 env 默认 |

### 输出格式（示例）

```
【Wiki Scope】
· FAQ（uuid-…）
  定位：售后政策与常见疑问
  标签：退款, 发票, …

【搜：退款】top 3
1) FAQ/wiki/refund-policy (0.82)
   …preview…
```

### 安全 / 边界

- 仅 **maintainerChatId** 会话可触发（复用 `isMaintainerChat`）
- 回复长度上限（如 3500 字），防刷屏
- 不暴露 API token / 内部路径

---

## 非目标（本票不做）

- 维护者自然语言闲聊 / Ops System Prompt（P0.5）
- Pre-flight 强制 `wiki_search`（客户侧）
- Console UI 改动

---

## 测试计划

1. 本地：配 maintainer → `scope` / `搜 xxx` 手测
2. `pnpm --filter @cococat/agent test` 新增 ops 解析用例
3. Golden：`搜` 与 Console 内 Search 结果 score 趋势一致（人工 spot check）

---

## 参考

- `docs/PLAN-escalation.md` §4 维护者通道
- `packages/agent/src/wiki-scope-refresh.ts`
- `packages/agent/src/wiki-context.ts`
