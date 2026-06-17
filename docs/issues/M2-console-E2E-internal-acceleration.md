# [M2 · Console] 内部加速全链路 E2E 验收清单

> **范围：** Phase 0（Rust Hub）→ Phase 2（Agent Worker）→ Phase 1（Wiki 内部化）→ Phase 3（Stack Orchestrator）  
> **用途：** 生产包实机复盘 / 自动化用例终审依据  
> **状态：** 待实机验收

---

## 架构演进对照（Legacy → Native Hub）

| 维度 | 重构前 | 重构后 |
|------|--------|--------|
| 健康探活 | 12s 周期 3× Bash + WebView HTTP | 1× Rust invoke，`tokio::join!` + 3s TTL |
| 收件箱热路径 | Localhost TCP + HTTP 序列化 | IPC `driver_fetch`，无 TCP |
| 事件推送 | WebView 裸连 WS，后台易假死 | Rust 单 WS + Tauri Event 扇出 |
| AI 预览 | 每次 `spawn node`，秒级冷启动 | 长驻 Worker，Stdio JSON-RPC ~150ms |
| Wiki 检索 | Agent → `:19828` HTTP | 双向 stdio 上游帧 → Rust RRF |
| 运行栈 | `cococat-stack.sh`，PATH 易丢 | Rust Orchestrator + 原子 PID |

---

## 场景一：零污染冷启动与环境健壮性

**方法：** 干净机器（无全局 Node、无 Cococat 进程），双击生产包启动 Console。

| # | Pass 指标 |
|---|-----------|
| 1.1 | 主窗体 ~100ms 内渲染，无黑屏/死锁 |
| 1.2 | 进程管理器中可见长驻 Node Worker（`worker-entry.js --worker`） |
| 1.3 | `~/.local/share/cococat/stack/*.pid` 原子写入，PID 与系统进程一致 |
| 1.4 | `ss -ltn \| grep 19828` 或等效审计：**无 19828 监听**（stealth 默认） |

---

## 场景二：收件箱热路径与 Payload 分流

**方法：** 收件箱内快速连续切换会话；打开含语音/大图的会话并加载媒体。

| # | Pass 指标 |
|---|-----------|
| 2.1 | 切换会话丝滑，无 IPC 阻塞白屏 |
| 2.2 | 大图/语音仍走 HTTP/blob 路径，JSON invoke 通道未卡死 |
| 2.3 | 会话 A/B 切换后 AI 辅助状态、草稿、Wiki 绑定不串道 |

---

## 场景三：AI 辅助与 Stdio 双向 Wiki 穿透

**方法：** 已绑 Wiki 的会话打开 AI 辅助，复杂 Wiki 提问。

| # | Pass 指标 |
|---|-----------|
| 3.1 | Enter → 首字 **< 150ms**（Worker 已 warm） |
| 3.2 | stderr/日志可见 Node 发 `direction:"request"`，Rust RRF 回刷；**无跨网卡 HTTP** |
| 3.3 | 多库联邦结果交织，无单库霸榜 Token |

---

## 场景四：实时事件与 WS 退避

**方法：** 对端发 3–5 条消息；再挂起 Driver/断网数秒后恢复。

| # | Pass 指标 |
|---|-----------|
| 4.1 | 正常网络下未读与气泡近实时更新（Tauri Event 扇出） |
| 4.2 | Driver down 后 health 变红，WS 桥接进入静默睡眠，无握手风暴 |
| 4.3 | 恢复后 WS 重连，漏消息 reconcile/补拉 |

---

## 场景五：级联收割与零残留

**方法：** 正常使用后点击 × 退出 Console。

| # | Pass 指标 |
|---|-----------|
| 5.1 | `RunEvent::Exit` 触发 Worker shutdown → stack `shutdown_all` → compose down |
| 5.2 | 退出 2s 后 `ps aux \| grep -E 'worker-entry|cococat-agent|gateway'` 无孤儿；stack PID 文件清除 |

**参考命令：**

```bash
ss -ltn | grep 19828          # 应无输出（未开 API Server）
ps aux | grep worker-entry    # 运行中应有 1 条；退出后应为 0
ls ~/.local/share/cococat/stack/*.pid  # 运行中有 pid；退出后应空
```

---

## 自动化可覆盖子集（开发机）

```bash
pnpm --filter @cococat/agent build
cd apps/console && pnpm exec tsc -b
cd apps/console/src-tauri && cargo test
```

| 项 | 命令 / 断言 |
|----|-------------|
| Worker ping | `cargo test worker_ping` |
| Stack PID | `cargo test stack_orchestrator` |
| Wiki upstream parse | `cargo test wiki_internal` |
| Phase 5 回归 | `pnpm --filter console test phase5-regression` |

---

## 关联 Issue

- Phase 0：health / driver_proxy / event_bridge — `51515ef`
- [Phase 2 Agent Worker](./M2-console-P2-agent-worker.md) — `9bae33e`
- [Phase 1 Wiki 内部化](./M2-console-P1-wiki-internal.md) — `8b1bcb1`
- [Phase 3 Stack Orchestrator](./M2-console-P3-stack-orchestrator.md) — `6bb1058`

---

## 终审签字

- [ ] 场景一 冷启动
- [ ] 场景二 收件箱
- [ ] 场景三 AI + Wiki
- [ ] 场景四 事件
- [ ] 场景五 退出零残留

验收人 / 日期：__________
