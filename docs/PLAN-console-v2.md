# CocoCat Console v2 实施计划

**状态**：已定稿 · **S0–E 已实现**（待 §10 真机验收）  
**原型**：[`docs/mockups/console-ui-v2.html`](mockups/console-ui-v2.html)（`docs/mockups` 下 `python3 -m http.server 8877` 预览）  
**上位文档**：[`PLAN-escalation.md`](PLAN-escalation.md)（是否回）、[`PLAN-humanize.md`](PLAN-humanize.md)（怎么说）、[`PLAN-console-ux.md`](PLAN-console-ux.md)（v1 清单，底层 Tab 可复用）

v2 在 v1 **六模块运维台**上重构为 **四区导航 + 维护者单一主用户**，默认 **总览**，视觉 **朴素灰调**。本文是 **唯一 Console 壳层实施清单**；v1 的 `PLAN-console-ux.md` 在壳层 IA 上被本文取代，组件与 Tauri 命令尽量复用。

---

## 0. 产品红线：客户不露馅

Console 是**维护者界面**；微信客户**看不到** Console。维护者在此配置的一切，决定客户是否察觉「对面是 AI」。

| 原则 | 对客户 | 对维护者 Console |
|------|--------|------------------|
| **品牌官方口吻** | 「我们」「这边」；不具名、不卖萌、不说「我是机器人/AI」 | 大脑 · 话术；试答带 **不露馅检查** |
| **DEFLECT 不撒谎** | 身份试探：偏转一次，不承认也不否认穿帮 | 大脑 · 分流 · `deflectLine` 可编辑 + 试答 |
| **不露馅回复形态** | 短句、无 markdown、无「根据知识库」类元话术 | 话术禁词清单；词条禁止模板腔 |
| **静默优于露馅** | 低置信 / 试探升级 → 宁可 mute 不回 | 分流 B / IGNORE；知识缺口补词条 |
| **转人工要自然** | `customerLine` 像同事接力，不提 AI/系统 | 分流 A 文案可预览 |

**口吻定稿**：与 [`PLAN-escalation.md`](PLAN-escalation.md) Grill #2 一致 — **B 品牌官方客服**，非卖萌「可可猫」人设。`persona.md.example`、`escalation.json.example` 默认文案须同步（实施包 **S0**）。

**Console 文案规范**：界面内可用「自动回复 / 接待引擎」指代 Agent；**客户侧文案编辑区**禁「AI、机器人、大模型、知识库检索」。气泡 meta（「自动回复 · 10:39」）仅维护者可见。

---

## 1. 目标与成功标准

维护者打开 Console 后：

1. **10 秒内**回答「能不能接客、下一步干嘛」
2. **一条主路径**处理待办：总览 → 收件箱 → 看画像/分流 → 解除 mute 或转个人微信
3. **大脑一处**改知识、话术、分流，试答预览客户听到的内容
4. **高级能力**（Memory 试跑、Wiki Lint、群聊 bridge、noVNC 桌面）不在主路径挡路

---

## 2. 现状盘点（代码基线）

| 区域 | 现状（`apps/console`） | v2 目标 |
|------|------------------------|---------|
| 导航 | `console-rail.tsx`：WeChat · Wiki · Agent · Memory · Stack + Settings | **总览 · 收件箱 · 大脑 · 系统** 四项 |
| 默认模块 | `console-store.ts` → `wechat` | → `overview` |
| 微信 | `wechat-module.tsx`：连接 \| 桌面 \| 会话；右栏无画像 | **收件箱**：会话 + **本会话** 右栏 |
| Agent | `agent-module.tsx`：persona \| chats \| bridge \| escalation | 收入 **大脑** 三 Tab |
| Wiki | `AppLayout` 全功能 IDE | 大脑「知识」简版；完整 IDE → 系统·高级 |
| 栈 | `stack-module.tsx`：服务 \| 日志 | 收入 **系统** |
| 设置 | `settings-module.tsx` 独立底部入口 | 收入 **系统·程序/高级** |
| 分流 | `agent-escalation-tab.tsx` + Tauri `list_escalation_mutes` / `unmute_escalation_chat` | 大脑「分流」+ 收件箱画像/建议条 |
| 命令面板 | `command-palette.tsx` 已有 ⌘K | 更新路由到新模块名 |
| 主题 | 现有 `index.css` / theme | 朴素灰变量（原型色板） |

**Agent 侧已具备**（`packages/agent`）：`EscalationService`、规则 triage、mute、`deflectLine` / `customerLine`。  
**已具备（Phase E 后）**：试答 preview API（Tauri）、`events.jsonl` 动线 / 知识缺口、`wiki-hits.json` 常命中、`read_chat_memory_summary`、统一会话/消息搜索（客户端跨 chat）、`wikiLinks` 分流↔词条 metadata、`ConsoleTopbar`。

---

## 3. 信息架构（定稿）

```
总览 ─ 能不能接客？建议下一步 + 特色能力 + 动线 + 待办
收件箱 ─ 微信会话 + 本会话（画像/分流/操作合一）+ 建议条
大脑 ─ 知识 · 话术 · 分流（Agent + Wiki 融合）
系统 ─ 服务 · 程序（含模型）· 日志 · 高级（界面 / Memory / Wiki IDE / bridge / 群聊搁置）
```

- 侧栏 **4 项**，默认 **总览**
- 无独立 Wiki / Memory / Agent 模块名
- noVNC：**系统 · 微信连接 · 排障**；收件箱「更多」可跳转（不删能力）

---

## 4. 功能矩阵

### 4.1 应凸显（差异化）

| 能力 | v2 落点 |
|------|---------|
| 私聊智能分流 | 总览特色区 · 收件箱分流摘要 · 大脑「分流」 |
| 维护者双通道 | 收件箱「维护者指令」；微信 `列表/已处理/解除` |
| mute 定时静默 | 收件箱状态 + 大脑分流侧栏活跃 mute |
| 知识驱动回复 | 大脑「知识」+ 收件箱「常命中」 |
| 不露馅配置 | 大脑话术 + 试答禁词检查 |
| 接客状态一问 | 总览顶栏 + 链路点 |
| 画像（简） | 收件箱右栏置顶 |

### 4.2 删减或降级

| 项 | v2 处理 |
|----|---------|
| Memory 试跑 | 系统 · 高级 |
| Wiki Lint / 审阅 / 来源监听 | 系统 · 高级 |
| 群聊 bridge 表单 | 系统 · 高级，标「搁置」 |
| 独立 Settings 侧栏 | 并入系统 |
| VNC 桌面主 Tab | 系统 · 微信连接排障 |
| 修订历史 / Memory 主路径 | 不出现 |

### 4.3 画像（简）字段

| 块 | 来源 | 可编辑 |
|----|------|--------|
| 基础 | Driver 联系人 | 否 |
| 标签 | 手动 + escalation 规则自动 | 手动增删 |
| 分流摘要 | `escalation-state` + mutes | 否 |
| 常命中知识 | Agent wiki recall 聚合（先 mock） | 否，可点进大脑 |
| 相处要点 | Memory L3 摘要 ≤3 条 | 只读；未启用占位 |

持久化：`~/.local/share/cococat/chats/{encodeChatDir}/profile.json` → `{ "tags": string[] }`

**不做（M1）**：订单、分群、独立 CRM、画像大屏。

---

## 5. 视觉原则

- 底色暖灰 `#121210`，无大面积渐变
- 强调：鼠尾草绿 `#8b9a7b`；告警赭石/灰红
- UI 系统无衬线；词条/正文 Newsreader
- 去掉 glow / 彩虹环 / 颗粒叠加

实现：`apps/console/src/index.css` 新增 `--console-v2-*` 变量；`lib/theme.ts` 可选接入。

---

## 6. 模块映射（v1 → v2）

| v1 模块 / Tab | v2 落点 | 复用组件 |
|---------------|---------|----------|
| Stack · 服务 | 系统 · 服务 | `stack-module` 服务卡逻辑 → `system-services-panel.tsx` |
| Stack · 日志 | 系统 · 日志 | 日志 Tab 原样迁入 |
| WeChat · 连接 | 系统 · 微信连接 | QR + 截图 + noVNC 折叠 |
| WeChat · 桌面 | 系统 · 微信连接 · 排障 | VNC iframe 逻辑 |
| WeChat · 会话 | 收件箱主区 | `wechat-chat-shell.tsx` |
| Agent · persona | 大脑 · 话术 | persona 编辑区 |
| Agent · escalation | 大脑 · 分流 | `agent-escalation-tab.tsx` 精简 |
| Agent · chats / bridge | 系统 · 高级 | 原 Tab 保留 |
| Wiki 全套 | 大脑 · 知识（简）+ 高级 | `wiki-editor` / `lint-view` 等 |
| Memory | 系统 · 高级 | `memory-module.tsx` |
| Settings | 系统 · 程序 + 高级 | `settings-module` 分组迁入 |

---

## 7. 实施阶段（详细）

### 工作包总览

| 包 | 名称 | 依赖 | 估时 |
|----|------|------|------|
| **S0** | 不露馅基线（文案 + Agent 纪律层对齐） | 无 | 2–3 天 |
| **A** | 壳层四区导航 + 主题 | 无 | 1–2 周 |
| **B** | 收件箱 + 画像（简） | A | 2 周 |
| **C** | 大脑三合一 + 试答 | A；试答依赖 S0 API | 2–3 周 |
| **D** | 总览 + 系统合并 | A, B 部分 | 1 周 |
| **E** | 增强（可选） | C, D | 按需 |

建议顺序：**S0 ∥ A** → **B ∥ C**（可并行）→ **D** → **E**

---

### S0 — 不露馅基线（横切，与 UI 并行）

**目标**：客户侧默认文案与纪律层一致，Console 试答有后端可挂。

| # | 任务 | 文件 / 位置 |
|---|------|-------------|
| S0.1 | 更新默认 `deflectLine` / `customerLine`（官方口吻，无 AI 词） | `escalation.json.example`、Console `DEFAULT_ESCALATION` |
| S0.2 | 更新全局 persona 示例为品牌官方客服（非卖萌猫） | `persona.md.example` 或 `~/.config/cococat` 模板 |
| S0.3 | 确认 Agent 纪律层 §5 已禁 AI 自称（已有则仅回归测试） | `packages/agent/src/system-prompt.ts` |
| S0.4 | 新增 **试答 preview** HTTP 或 Tauri 命令：输入问句 → `{ route, answer, stealthOk, bannedHits[] }` | `packages/agent` 新路由或 `apps/console/src-tauri` |
| S0.5 | 共享禁词表（与原型一致） | `apps/console/src/lib/stealth-check.ts` + agent 侧同表或 JSON |

**试答 API 草案**（Agent 侧）：

```
POST /preview-reply  或  invoke("preview_agent_reply", { query, chatId? })
→ { action: TriageAction, reason: string, answer: string, wikiHits?: string[] }
```

实现：走 triage 规则 + 可选 wiki search + **不发送**、不写 mute；persona 用全局或指定 chat。

**验收**：问「你是不是机器人」→ `DEFLECT` + deflectLine；answer 过 `stealthOk`；含「知识库」→ `stealthOk: false`。

---

### Phase A — 壳层与导航（1–2 周）

| # | 任务 | 文件 |
|---|------|------|
| A.1 | 扩展 `ConsoleModule`：`overview \| inbox \| brain \| system`；迁移 localStorage（旧值映射：wechat→inbox, agent+wiki→brain, stack+settings→system） | `stores/console-store.ts`, `lib/console-layout.ts` |
| A.2 | 重写 `console-rail.tsx` 四项 + 健康点（Driver/接待引擎/Wiki） | `components/console/console-rail.tsx` |
| A.3 | 新建占位模块（可先空壳） | `overview-module.tsx`, `inbox-module.tsx`, `brain-module.tsx`, `system-module.tsx` |
| A.4 | `App.tsx` 路由切换；Wiki 不再作为默认 `activeModule` 入口 | `App.tsx` |
| A.5 | 顶栏 `ConsoleTopbar`：状态 pill + 维护者 meta + ⌘K + CTA「处理待办」 | `console-topbar.tsx` ✅ |
| A.6 | 朴素主题变量 | `index.css`, 可选 `lib/console-theme.ts` |
| A.7 | i18n：`console.modules.*` 四区文案 | `i18n/zh.json`, `i18n/en.json` |
| A.8 | `command-palette.tsx` 命令组更新到新模块 | `command-palette.tsx` |
| A.9 | 删除 rail 底部独立 Settings 按钮（功能迁系统） | `console-rail.tsx` |

**验收**：启动默认总览；旧用户 localStorage 不白屏；⌘K 可跳四区。

---

### Phase B — 收件箱（2 周）

| # | 任务 | 文件 |
|---|------|------|
| B.1 | `inbox-module.tsx` = 左会话列表 + 中气泡 + 右 **本会话** | 新模块；拆自 `wechat-module` |
| B.2 | `InboxContextPanel`：画像 · 分流摘要 · 命中知识 · 维护者指令 · mute 操作 | `components/console/inbox-context-panel.tsx` |
| B.3 | 建议条（按 mute / A/B 级变化文案） | 同上或 `inbox-hint-bar.tsx` |
| B.4 | 气泡 meta：`isSelf` →「自动回复」vs「客户」；维护者指令气泡单独样式 | `wechat-chat-shell.tsx` |
| B.5 | 会话搜索（左栏 filter，沿用现有 listQuery） | 已有，迁入 inbox |
| B.6 | 更多菜单：跳转系统·微信连接·排障 | inbox 顶栏 |
| B.7 | 解除 mute / 标已处理 | 接 `unmuteEscalationChat`；标已处理若需新 Tauri 命令则补 |
| B.8 | `profile.json` 读写 | `src-tauri` 新命令 `read_chat_profile` / `write_chat_profile` |
| B.9 | 待办角标：活跃 mute 数 → 收件箱 nav-badge | `use-stack-health` 或 escalation poll |
| B.10 | 移除收件箱到 Agent/Memory 的跨模块按钮（改「大脑」「高级」链接） | `wechat-chat-shell.tsx` |

**画像数据流（M1）**：

```
Driver chats/messages ─┬─► 基础信息
escalation/mutes.json ─┼─► 分流摘要（Tauri 已有）
profile.json ──────────┼─► 手动标签
常命中 / Memory ───────┴─► 先静态 mock → Phase E 接 Agent
```

**验收**：选张三（A 级 mute）→ 建议条提示个人微信；解除 mute 生效；标签刷新后仍在。

---

### Phase C — 大脑（2–3 周）

| # | 任务 | 文件 |
|---|------|------|
| C.1 | `brain-module.tsx` + Tab：知识 \| 话术 \| 分流 | 新模块 |
| C.2 | **话术** Tab：复用 Agent persona 编辑 + **不露馅面板** + 禁词 chips | 从 `agent-module` persona 段抽出 |
| C.3 | **分流** Tab：精简 `AgentEscalationTab`（deflect/customerLine 突出，维护者选择保留） | `agent-escalation-tab.tsx` |
| C.4 | **知识** Tab：Wiki 简版 — 项目切换 + 树 + 单页编辑；隐藏 Lint/审阅/来源 | 新 `brain-wiki-panel.tsx`，复用 `wiki-editor` |
| C.5 | 词条侧栏：**分流联动**（哪些 action 引用该词条 — 先静态标注，后接 metadata） | brain 知识右栏 |
| C.6 | **试答**侧栏：调 S0.4 preview API + `stealth-check.ts` 展示 | `brain-try-ask-panel.tsx` |
| C.7 | 群聊策略折叠「搁置」 | 分流 Tab 底部 |
| C.8 | 保存路径不变：`persona.md`、`escalation.json`、wiki 项目目录 | 现有 `agent-config-client` |

**验收**：改 deflectLine → 试答「机器人」路径变；改词条后试答 wikiHits 变；话术含禁词 → 试答标红。

---

### Phase D — 总览与系统（1 周）

| # | 任务 | 文件 |
|---|------|------|
| D.1 | `overview-module.tsx`：状态 hero + 链路点 + **建议下一步**（1–2 条，来自 mute/health） | 新模块 |
| D.2 | 特色四格（可点进大脑/收件箱） | overview |
| D.3 | 今日动线：时间线（mute、分流、告警 — 先 mock 事件列表，接 Agent 日志后换源） | `overview-timeline.tsx` |
| D.4 | 待办列表 + 「全部标已处理」 | overview |
| D.5 | Driver down **修复向导**（跳系统·服务 / 微信连接） | overview |
| D.6 | `system-module.tsx` 侧栏：服务 \| 程序 \| 日志 \| 高级 | 新模块 |
| D.7 | **微信连接**：QR（主）+ 截图 + noVNC（折叠排障） | 从 `wechat-module` connect/desktop 合并 |
| D.8 | **程序**：原 Settings `cococat` 组 + 模型配置 | `settings-module` 迁入 |
| D.9 | **高级**：界面、Memory 模块、Wiki IDE 全套、bridge | 原模块 iframe 式嵌入 |
| D.10 | `stack-health-alerts` 文案与四区导航对齐 | `stack-health-alerts.tsx` |

**验收**：Driver 挂 → 总览红灯 + 向导；特色卡点击到位；系统可启停栈 + 扫码。

---

### Phase E — 增强（可选）

| # | 任务 | 说明 |
|---|------|------|
| E.1 | 知识缺口队列 | ✅ `overview-kb-gaps.tsx` + `events.jsonl` |
| E.2 | 今日动线接真实事件源 | ✅ `list_console_events` |
| E.3 | 常命中 / Memory 摘要 API | ✅ `wiki-hits.json` + `read_chat_memory_summary` |
| E.4 | 命令面板与会话搜索统一索引 | ✅ `unified-inbox-search.ts`（会话 find + 跨 chat 消息，无 Driver FTS） |
| E.5 | 浅色主题第二套变量 | ✅ `console-theme.ts` + `index.css` |
| E.6 | 大脑词条 ↔ 分流规则双向 metadata | ✅ `wikiLinks` 分流 Tab 可编辑 + 知识 Tab 只读提示 |

---

## 8. 关键文件清单（新建）

```
apps/console/src/
  components/console/
    overview-module.tsx
    overview-timeline.tsx
    inbox-module.tsx
    inbox-context-panel.tsx
    inbox-hint-bar.tsx
    brain-module.tsx
    brain-wiki-panel.tsx
    brain-try-ask-panel.tsx
    system-module.tsx
    system-services-panel.tsx
    system-wechat-connect.tsx
    console-topbar.tsx          # ✅
  lib/
    stealth-check.ts
    console-theme.ts          # 可选
    inbox-profile.ts          # profile.json 客户端
```

**修改为主**：`console-rail.tsx`, `console-store.ts`, `console-layout.ts`, `App.tsx`, `wechat-chat-shell.tsx`, `agent-escalation-tab.tsx`, `command-palette.tsx`, `index.css`, `i18n/*.json`

**Tauri 新增（草案）**：`read_chat_profile`, `write_chat_profile`, `preview_agent_reply`（或 HTTP 代理）

---

## 9. 导航与状态（`console-store` 扩展）

```ts
type ConsoleModule = "overview" | "inbox" | "brain" | "system"

// 新增 pending 导航（与 v1 类似）
pendingInboxChatId: string | null
pendingBrainTab: "kb" | "persona" | "routing" | null
pendingSystemPanel: "services" | "program" | "logs" | "advanced" | null
pendingSystemWechat?: boolean   // 打开微信连接并展开排障
```

**迁移映射**（一次性读旧 `activeModule`）：

| 旧值 | 新值 |
|------|------|
| wechat | inbox |
| wiki, agent, memory | brain |
| stack, settings | system |

---

## 10. 验收清单（发布前）

- [ ] 打开默认总览，10 秒内可答「能否接客」
- [ ] 特色四项可见可点；分流/知识文案体现不露馅
- [ ] 总览「建议下一步」可跳收件箱或大脑
- [ ] 系统 · 微信连接：QR 为主、noVNC 排障
- [ ] 收件箱：建议条随会话变化；更多菜单含 VNC
- [ ] 大脑试答：分流路径 + 拟答 + **不露馅检查**
- [ ] 客户侧文案无「AI、机器人、知识库」等露馅词（默认配置）
- [ ] Console 维护者用语与客户侧分离（meta「自动回复」）
- [ ] 收件箱：待办 → 画像 → 分流原因 → 解除 mute
- [ ] 画像：标签可编辑；escalation 一致；Memory 未启用有占位
- [ ] 大脑：改词条 → 分流联动提示 → 试答
- [ ] Memory / 群聊 / Wiki IDE 全套不在主路径
- [ ] 视觉：朴素灰、无荧光渐变、对比度可读
- [ ] 旧用户 localStorage 迁移无回归

---

## 11. 风险与边界

| 风险 | 缓解 |
|------|------|
| Wiki 与 Console 启动耦合（须选 project） | 大脑「知识」保留 project 选择；总览/收件箱不依赖 wiki project |
| 试答与真实回复不一致 | 试答走同一 triage + persona + wiki 路径；标注「预览」 |
| v1 文档与实现双轨 | 壳层以本文为准；`PLAN-console-ux.md` 顶部加「v2 取代壳层 IA」注记 |
| 可可猫 vs 官方口吻 | S0 统一示例；`CONTEXT.md` 品牌句可保留「AI 伙伴」对外叙事，**微信回复**以官方客服为准 |

**非目标（本计划不做）**：Console 内代发微信、群聊 triage、完整 CRM、坐席多用户权限。

---

## 12. Issue 切片（可独立 PR）

1. **S0** 不露馅文案 + `stealth-check` + preview API  
2. **A1** 四区 rail + store 迁移 + 空壳模块  
3. **A2** 主题变量 + topbar  
4. **B1** inbox 三栏布局 + chat shell 迁入  
5. **B2** InboxContextPanel + profile.json Tauri  
6. **B3** 建议条 + mute 操作 + nav badge  
7. **C1** brain 壳 + 话术/分流迁入  
8. **C2** brain 知识简版  
9. **C3** 试答侧栏接 API  
10. **D1** overview 全页  
11. **D2** system 四 panel 合并  

每个 PR 附：原型对应区块截图 + 验收子集（§10）。

---

## 13. 文档关系

| 文档 | 关系 |
|------|------|
| [`PLAN-escalation.md`](PLAN-escalation.md) | 分流行为真相；大脑分流 Tab 与其一致 |
| [`PLAN-humanize.md`](PLAN-humanize.md) | 纪律层、transcript、Memory；话术 Tab 与之互补 |
| [`PLAN-console-ux.md`](PLAN-console-ux.md) | v1 Tab/组件细节；底层复用 |
| [`mockups/console-ui-v2.html`](mockups/console-ui-v2.html) | 交互与文案参考 |
| [`CONTEXT.md`](../CONTEXT.md) | 模块命名与 M1 边界 |

---

*最后更新：2026-06-09 — S0–E 开发完成；遗留：§10 真机验收、Newsreader 衬线、Driver 消息 FTS（可选）、`wiki` 逃生模块 eventual 移除*
