# M2 维护者 Ops — 架构终审归档

**状态：** Design Signed-off（M1 合入后封存，M2 未开工）  
**日期：** 2026-06  
**票单：** [P0 Wiki 嗅探](./M2-ops-P0-wiki-sniff.md) · [P1 记忆消歧](./M2-ops-P1-memory-pick.md)

---

## 终审结论

M2 维护者通道在 M1 **纯指令控制面** 之上做 **增量扩展**，不破坏 `monitor` 处数据流/控制流硬切分。两条票单均通过架构终审，作为实现期的 **Design Invariant（设计不变量）** 执行。

---

## P0 · Wiki 嗅探 — 确定性控制面

**定位：** 绝对的确定性控制面；移动端 Wiki 白盒嗅探器。

| 不变量 | 说明 |
|--------|------|
| **零 LLM** | `scope` / `搜` / `读` 剥离大模型推理层，直连 `WikiClient` HTTP + 本地 `wiki-scope` 快照 |
| **零 Token / 零幻觉延迟** | 查到了即 path + score + preview；没查到即 0 条，不经模型转述 |
| **严禁客服腔** | 禁止 `deflectLine` / `customerLine` / 「亲亲」类话术；Ops 回复硬核、技术向 |
| **路由不变** | 仍走 `processMaintainer` → 结构化指令分支；未命中指令 **不** 自动进 ChatSession（P0 范围） |

---

## P1 · 记忆查询 — PII 级防火墙

**定位：** 主观题（绑 `chatId`）的只读窥视；安全优先级高于便利。

| 不变量 | 说明 |
|--------|------|
| **PII 铁律** | **记忆涉及 PII，宁可多问一句，不可 silent wrong chat.** |
| **分支流水线** | `0` 报错 · `1` 直出 · `2–5` → `pick_memory` · `>5` 拒绝待选 |
| **概念资产平移** | 100% 复用 M1 `pick_unmute` + `pickCandidate` 状态机；运维仍用「回 `1`」消歧 |
| **消歧元数据** | 微信备注 · mute 状态 · Console tags · 最近用户话切片 · chatId 短后缀 |
| **禁止 LLM 选目标** | 解析与消歧全程确定性；LLM 不参与 chatId 决策 |

---

## 与 M1 的边界

```
M1（已合入 main）
  维护者 → 仅 列表 / 解除 / 已处理 + pick_unmute
  客户   → ChatSession + unified gate + wiki scope

M2 P0  维护者 → + scope / 搜 / 读（无 LLM）
M2 P1  维护者 → + 记忆 + pick_memory（无 LLM 选 chat）
M2+    可选   → 自然语言 Ops ChatSession（P0.5，单独票）
```

---

## 开工顺序

1. **P0** Wiki 嗅探（无依赖）  
2. **P1** 记忆消歧（依赖 P0 稳定 + Memory gateway）  
3. **P0.5**（可选）未命中结构化指令时的 Ops System Prompt

---

## 参考

- `docs/PLAN-escalation.md` §4 维护者通道  
- `packages/agent/src/escalation/service.ts`  
- M1 commit：`6ae4596`（monorepo + 私聊客服线 + wiki scope）
