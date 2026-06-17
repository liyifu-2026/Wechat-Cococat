# [M2 · P1] 维护者 Ops：`记忆` 查询 + `pick_memory` 重名消歧

> **Archival：** 设计不变量见 [`M2-ARCHIVE.md`](./M2-ARCHIVE.md) — PII 铁律、pick_unmute 状态机平移、禁止 LLM 选 chat。

**类型：** Feature · Maintainer Ops · Security-sensitive  
**优先级：** P1（依赖 P0 Wiki 嗅探合入并稳定）  
**依赖：** `M2-ops-P0-wiki-sniff`、Memory gateway 可用、`findChats` / `listAgentChats`  
**预估：** 2–3 人日

---

## 背景

Wiki 是 **客观题**（不绑 chatId）；Memory 是 **主观题**（必须绑 `chatId`）。运维在微信上排查「记错了客户」时，需要 `记忆 张三` 类指令，但 **绝不能 silent wrong chat**——PII 穿帮为线上事故。

**最高纲领：** 记忆涉及 PII，宁可多问一句，不可 silent wrong chat。

交互 **100% 复用** 现有 `pick_unmute` + `pickCandidate` 状态机，运维仍用「回 `1`」消歧。

---

## 目标

| 指令 | 行为 |
|------|------|
| `记忆 <query>` | 查指定客户的 Memory + persona「相处记忆」摘要（只读） |
| query = chatId 形态 | `getChat` 精确查，失败即报错 |
| query = 昵称/备注 | `findChats` + Agent chat 目录交叉；0/1/N 分支见下 |

### 分支行为

| 命中数 | 行为 |
|--------|------|
| 0 | 「未找到，请用更全备注名或 chatId」 |
| 1 | 直接输出记忆快照 |
| 2–5 | 写入 `maintainer-session.json` → `action: "pick_memory"`，列编号列表 + 消歧元数据 |
| >5 | 不进入待选：「命中过多，请用 chatId 或更长备注名」 |

### 待选态跟进

- 运维回 `1` / 更全备注名 / chatId 后缀 → 复用 `pickCandidate`（扩展 chatId 后缀匹配）
- TTL 10 分钟；过期清 pending
- 与 `pick_unmute` **互斥**（同一 `maintainer-session.json`，新指令覆盖旧 pending）

---

## 消歧列表格式（硬性）

```
⚠️ 匹配到 2 个「张三」：
1) 张三-设计 · 转人工 · mute 剩 3h
   最近：「发票什么时候开」
   chatId: …abc4
2) 张三-销售 · 自动回复中
   最近：「套餐多少钱」
   chatId: …def9

请回复序号、更完整备注名，或 chatId。
```

**消歧字段（按优先级叠加）：**

1. Driver `Chat.name` / 备注  
2. mute 状态 + 原因（`mutes.json`）  
3. Console `profile.json` tags（若有）  
4. transcript 末条用户话（截断 ~40 字）  
5. chatId 短后缀  

---

## 记忆快照内容（只读）

对选定 `chatId` 输出（Markdown Plain，Ops 腔）：

- `memoryClient.recall(chatId, query="")` 或固定 ops 查询（≤N 行）
- `chats/{id}/persona.md` 中 `## 相处记忆` 段落（若存在）
- **不**输出完整 persona / 完整 transcript
- 可选：最近一条 `agent_trace` turnId（P1.1）

禁止客服腔、禁止写入 Memory。

---

## 验收标准

- [ ] `记忆 wxid_xxx` 精确命中，错误 id 有明确报错
- [ ] 唯一昵称命中 → 直接快照，无二次确认
- [ ] 重名 → numbered 列表 + `pick_memory`；回 `1` 正确解析
- [ ] 重名 >5 → 拒绝待选，提示缩小范围
- [ ] **从不**在 N>1 且未待选确认时输出记忆内容
- [ ] pending 10 分钟过期；与 `pick_unmute` 互斥有测试
- [ ] 单元测试：`resolveMemoryTarget()` 0/1/N/>5 + `pickCandidate` 扩展

---

## 实现要点

### 类型扩展

```typescript
// packages/agent/src/escalation/types.ts
type MaintainerPending =
  | { action: "pick_unmute"; candidates: [...] }
  | { action: "pick_memory"; candidates: MemoryCandidate[]; expiresAt: number }
```

### 代码触点

| 模块 | 改动 |
|------|------|
| `escalation/service.ts` | `handleMaintainerMessage` 增加 `记忆` 与 `pick_memory` 分支 |
| `escalation/state-store.ts` | pending TTL、互斥写入 |
| `ops/memory-peek.ts`（新） | 解析 query、候选聚合、快照格式化 |
| `escalation/service.ts` `pickCandidate` | chatId 后缀 / 更长名匹配 |

### 候选池构建

```
findChats(query)
  → 优先保留 listAgentChats() 中存在的 chatId
  → 附加 mute / profile / transcript 元数据
  → 按 exact name 匹配 > 最近活跃 排序
```

**禁止：** LLM 选择目标 chat；禁止 fuzzy 自动 pick（唯一 exact 全名匹配可自动，默认 M2 仍保守 → 可选 feature flag）。

---

## 安全

- 仅 maintainerChatId 可执行
- 快照脱敏选项（P1.1）：手机号/身份证正则打码
- 审计：`appendConsoleEvent({ kind: "ops_memory_peek", chatId, … })`（新 kind，可选）

---

## 非目标

- 维护者修改 / 删除 Memory
- 跨 chat 批量导出
- Console UI（Inbox 已有 session picker，可后续链过去）

---

## 测试计划

1. fixture：2 个同名 chat → 列表 → 选 1 → 快照  
2. fixture：6 个命中 → 拒绝  
3. pending 过期后 `1` 不再误绑  
4. 与 `解除` 多选交替使用不串状态  

---

## 参考

- `docs/PLAN-escalation.md` §4、`maintainer-session.json`
- `packages/agent/src/escalation/service.ts` `pick_unmute` / `pickCandidate`
- `apps/console/src/components/console/session-key-picker.tsx`（chatId 数据源参考）
