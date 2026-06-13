# CocoCat Console UX 实施计划

本文档汇总 **Console 交互 grill 定稿** 与后续讨论的增强项。与 [`PLAN-merge-cococat.md`](PLAN-merge-cococat.md)（品牌/架构）、[`PLAN-humanize.md`](PLAN-humanize.md)（Agent 行为）并列。

> **v2 壳层 IA** 已由 [`PLAN-console-v2.md`](PLAN-console-v2.md) 取代（四区导航：总览/收件箱/大脑/系统）。本文仍有效于 **底层 Tab 组件、Tauri 命令、WeChat 气泡** 等实现细节，开发时两文档对照使用。

静态原型参考：[`docs/mockups/console-ui-v1.html`](mockups/console-ui-v1.html)（本地 `python3 -m http.server` 于 `docs/mockups/` 目录预览）。

---

## 1. 全局原则（已定稿）

| 原则 | 说明 |
|------|------|
| 模块全可点 | 侧栏不锁模块；问题用提示/跳转解决，不隐藏入口 |
| 单一模块轨 | **仅 ConsoleRail** 切换 Wiki / WeChat / Agent / Memory / Stack；Wiki 内不再保留第二条 IconSidebar |
| 模块内 Tab | 运维类页面按业务拆顶栏 Tab；样式统一（`ModuleTabs`） |
| 四段式布局 | ① 顶栏（标题 + 本页主操作）② 主区 ③ 次区 ④ 诊断（日志默认独立 Tab 或折叠） |
| 状态默认页 | 结合服务状态（A+C）：blocker 强制覆盖；其余 `localStorage` 记上次 Tab |
| 扁平视觉 | Console 模块统一 `CONSOLE_PANEL`；Wiki 逐步去掉 `shadow-lg` 双栏感 |
| WeChat 置顶 | 侧栏顺序：**WeChat → Wiki → Agent → Memory → Stack**；首次默认模块 `wechat` |
| 无联系人 Tab | WeChat 仅 `连接 \| 桌面 \| 会话`；不做独立通讯录模块 |

---

## 2. 分模块规格

### 2.1 ConsoleRail

- 顺序：WeChat · Wiki · Agent · Memory · Stack；底部 Settings
- **健康圆点可点击**：点 WeChat 黄点 → WeChat「连接」；点 Memory 红 → Stack「服务」Memory 卡；Tooltip 写清状态文案
- 删除 `GettingStartedBanner` 全页顶栏常驻 → 迁入 Stack「服务」页内提示条

### 2.2 Stack

| Tab | 内容 |
|-----|------|
| **服务** | 顶：启动全部 · 停止全部 · 刷新；下：Driver / Memory / Agent 三卡；错误仅在对应卡内；可选三步流水线（Driver → 微信 → Agent）可点击跳转 |
| **日志** | 命令输出 + Agent log；服务页不出现日志 |

Memory 缺 gateway 文案标明 **可选 · 长期记忆**，附一键复制 clone 命令。

### 2.3 WeChat

| Tab | 内容 |
|-----|------|
| **连接** | 登录状态、扫码、QR；Driver 不可达时引导 Stack |
| **桌面** | VNC **独占主区**；顶栏：刷新 / 浏览器打开 / 切连接 |
| **会话** | **仿微信**：左会话列表（头像/预览/时间）+ 右气泡（自绿 `#95ec69` / 他白底）；底栏只读占位；**会话内搜索**（见 §4.3） |

**默认 Tab**：不可达或未登录 → **连接**；已登录 → **桌面**；记 `wechat.lastTab`，未登录时强制连接。

**跨模块**（会话选中后）：跳转 Agent「Chats」、Memory「试跑」并带 sessionKey。

### 2.4 Memory

| Tab | 内容 |
|-----|------|
| **概览** | Gateway 健康、L3 只读；down 时引导 Stack |
| **试跑** | SessionKey、Recall、Capture |

默认：down → 概览；up → 试跑；从 Agent 跳转 → 试跑 + `prefillSessionKey`。

### 2.5 Agent

| Tab | 内容 |
|-----|------|
| **persona** | 编辑区满高 + **底栏固定**保存/重置 |
| **chats** | 左列表 · 右 persona 片段 + wiki 映射 |
| **bridge** | 表单为主；原始 JSON 默认折叠 |

默认：③ 首次 persona，之后 `agent.lastTab`；Tab 组件与其他模块一致。

### 2.6 Wiki

- 移除 **IconSidebar**（或不再渲染）
- 顶栏 Tab：**词条 · 来源 · 搜索 · Lint · 审阅**
- 左：文件树 + Activity（按需）；顶左 **项目名 ▾** 切换项目
- Settings 仅从 ConsoleRail 底部进入

### 2.7 Settings

- 顶栏 **3 组 Tab**：**程序 · Wiki 与模型 · 系统**
- 组内左侧子项 + 右侧表单；默认组 **程序**
- 组内 **搜索**（代理 / token / DeepSeek 等关键词）
- 持久化：`settings.lastGroup` + `settings.lastCategory`

| 组 | 子项 |
|----|------|
| 程序 | 路径、Token、打开目录、跳转 Agent/Stack |
| Wiki 与模型 | LLM、Embedding、多模态、网络搜索、输出语言、来源监听、定时导入 |
| 系统 | 界面与语言、网络代理、API 服务、维护、关于 |

### 2.8 深色模式

- `index.css` 已有 `.dark` 变量；在 **系统 · 界面** 增加主题：**跟随系统 / 浅色 / 深色**
- 应用方式：`document.documentElement.classList.toggle('dark', …)`；持久化 `cococat.theme`
- Console 运维模块与 Wiki 壳层对齐（避免硬编码浅色 WeChat 仿壳区域在深色下刺眼——会话 Tab 用 CSS 变量派生微信色）

---

## 3. 增强能力（并入同一计划）

### 3.1 状态通知

- 扩展 `useStackHealth` 或新建 `useStackHealthAlerts`：对比上一轮快照，在变化时：
  - **Toast**（`toast-store`）：Agent down/up、微信 logged_out、Driver unreachable、Memory down（可选）
  - **系统通知**（Tauri `tauri-plugin-notification` 或 Web Notification）：仅当窗口失焦或用户开启「系统通知」设置时
- 设置项：系统 · 界面或 程序 组 — 「栈状态系统通知」开关

### 3.2 命令面板（Ctrl+K / Cmd+K）

- 全局 `CommandPalette` 挂 `ConsoleShell`
- 命令示例：
  - 切换模块（WeChat / Wiki / …）
  - Stack：启动全部 / 停止全部 / 启动 Driver
  - WeChat：打开连接 / 桌面 / 会话
  - 打开会话（搜索会话名，选中后切 WeChat 会话 Tab 并选中）
  - 打开 Settings 某分类（可选）
- UI：居中对话框 + 模糊过滤 + 键盘上下选择

### 3.3 会话搜索

- **一期（Console）**：当前会话内，拉取较大 `limit`（如 200）消息，前端 filter + 高亮；搜索框在会话 Tab 左栏顶
- **二期（Driver，可选）**：`GET /api/messages/{chat_id}/search?q=` 利用 `message_fts.db` 或 SQL `LIKE`，分页返回
- 命令面板「打开会话」与会话内搜索共用会话列表数据源

### 3.4 健康轮询优化

- 当前模块相关项 poll 更勤，其他更慢；用户点「刷新」立即全量拉取

---

## 4. 实施阶段（推荐顺序）

### Phase 0 — 基础设施（先做）✅

| 项 | 产出 |
|----|------|
| `ModuleTabs` | `apps/console/src/components/console/module-tabs.tsx` |
| Tab 持久化 | `lib/console-layout.ts` + `hooks/use-module-tab.ts` |
| `theme` 加载 | `lib/theme.ts`；`main.tsx` + `index.html` 防 FOUC |
| 计划内已落地（勿回退） | `console-rail` WeChat 置顶、`console-store` 默认 wechat、`stack.rs` `repo_root` 三级、`cococat-stack.sh` PATH/Docker |

### Phase 1 — Stack + 通知基础 ✅

1. Stack 拆 Tab（服务 / 日志）+ GettingStartedBanner 迁入服务页  
2. Stack 服务页三步流水线（`StackPipeline`）  
3. `useStackHealthAlerts` + Toast（`StackHealthAlerts`）  
4. 侧栏健康点可点击跳转（`navigateWeChat` / `navigateStack`）  

### Phase 2 — WeChat 重构（最大块）✅

1. Tab：连接 / 桌面 / 会话 + 默认页逻辑 + `wechat.lastTab`  
2. 桌面 VNC 全屏主区  
3. 会话仿微信布局组件 `wechat-chat-shell.tsx`  
4. 会话内搜索（一期前端 filter，200 条消息）  
5. 跨模块跳转 Agent / Memory（`openAgentWithSession`）  

### Phase 3 — Memory + Agent ✅

1. Memory 概览 / 试跑 Tab + 默认页
2. Agent Tab 样式统一 + persona 底栏固定 + chats 左右分栏

### Phase 4 — Wiki + Settings ✅

1. 移除 IconSidebar，顶栏 Wiki 子 Tab
2. Settings 三组 + 组内 nav + 搜索
3. 界面组：主题（深/浅/系统）

### Phase 5 — 命令面板 + 系统通知 ✅

1. `CommandPalette` + 全局快捷键  
2. Tauri notification 插件 + 设置开关  
3. Driver 消息搜索 API — **跳过**（一期前端 200 条 filter 已够用）  

---

## 5. 主要改动文件（预估）

```
apps/console/src/
  components/console/
    module-tabs.tsx          # 新
    command-palette.tsx      # 新
    stack-health-alerts.tsx  # 新（或 hook）
    stack-module.tsx         # Tab 拆分
    wechat-module.tsx        # Tab + 仿微信会话
    wechat-chat-shell.tsx    # 新
    memory-module.tsx
    agent-module.tsx
    console-rail.tsx         # 可点击 health
    console-shell.tsx        # 挂 CommandPalette + alerts
    getting-started-banner.tsx # 删除或仅 Stack 引用
  components/layout/
    icon-sidebar.tsx         # 删除或 Wiki 不再使用
    app-layout.tsx           # Wiki 顶 Tab
  components/settings/
    settings-view.tsx        # 三组结构
    sections/interface-section.tsx  # 主题
  hooks/
    use-stack-health-alerts.ts
  lib/
    theme.ts                 # 新
    driver-client.ts         # searchMessages（二期）
  stores/
    console-store.ts         # 可选：openWeChatChat(chatId)
  i18n/zh.json, en.json

packages/driver/               # Phase 5 可选
  src/router/messages.rs
  src/tools/wechat_messages.rs

apps/console/src-tauri/        # Phase 5
  Cargo.toml                   # tauri-plugin-notification
```

---

## 6. 验收清单

- [ ] 侧栏 WeChat 第一；首次打开默认 WeChat（无历史时）
- [ ] 全模块可点；无全页 GettingStartedBanner
- [ ] Stack 服务/日志分离；Memory 错误在卡片内
- [ ] WeChat 三 Tab；已登录默认桌面；会话仿微信；无联系人 Tab
- [ ] Agent/Memory/Wiki/Settings 符合 §2 规格
- [ ] Agent 掉线 / 微信登出 → Toast；可选系统通知
- [ ] Ctrl+K 可切模块、启停栈、打开会话
- [ ] 会话 Tab 内可搜当前聊天历史
- [ ] 深色模式三态可用，Console 模块视觉一致
- [ ] 原型 HTML 与实现布局无重大偏差

---

## 7. 非本计划范围（明确不做）

- Console 内发送微信消息（M1 仍只读）
- 独立「联系人 / 通讯录」Tab
- 锁死未就绪模块的侧栏入口

---

*文档版本：与 2026-06 grill 定稿及 mockup v1 同步。*
