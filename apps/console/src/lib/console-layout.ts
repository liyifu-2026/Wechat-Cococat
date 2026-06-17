/**
 * CocoCat Console layout — localStorage keys and tab persistence.
 * v2 壳层见 docs/PLAN-console-v2.md；底层 Tab 见 docs/PLAN-console-ux.md
 */

export const LAYOUT_KEYS = {
  activeModule: "cococat.console.activeModule",
  activeModuleV2Migrated: "cococat.console.v2ModuleMigrated",
  wechatShellTab: "cococat.wechat.shellTab",
  wechatShellMigrated: "cococat.wechat.shellMigrated",
  knowledgeShellTab: "cococat.knowledge.shellTab",
  brainTab: "cococat.brain.lastTab",
  systemPanel: "cococat.system.lastPanel",
  systemAdvancedTab: "cococat.system.advancedTab",
  theme: "cococat.theme",
  wechatTab: "cococat.wechat.lastTab",
  agentTab: "cococat.agent.lastTab",
  stackTab: "cococat.stack.lastTab",
  memoryTab: "cococat.memory.lastTab",
  wikiTab: "cococat.wiki.lastTab",
  systemKnowledgeTab: "cococat.system.knowledgeTab",
  settingsGroup: "cococat.settings.lastGroup",
  settingsCategory: "cococat.settings.lastCategory",
  stackNotifications: "cococat.stackNotifications",
} as const

export type ConsoleModuleV2 = "overview" | "inbox" | "brain" | "system"

/** v2 侧栏四区（Phase 6A：legacy `wiki` 模块已退役） */
export type ConsoleModule = ConsoleModuleV2

/** 微信壳层主导航 Tab */
export type WechatShellTab = "chats" | "contacts" | "kb"

export const WECHAT_SHELL_TABS: readonly WechatShellTab[] = [
  "chats",
  "contacts",
  "kb",
]

export type BrainTab = "kb" | "persona" | "routing"

/** 知识库壳层子 Tab（含 Wiki 搜索） */
export type KnowledgeShellTab = BrainTab | "search"

export const KNOWLEDGE_SHELL_TABS: readonly KnowledgeShellTab[] = [
  "kb",
  "persona",
  "routing",
  "search",
]

/** 齿轮设置 Modal 一级分组 */
export type WechatSettingsGroup =
  | "ai-settings"
  | "wechat-ops"
  | "system-advanced"

export const WECHAT_SETTINGS_GROUPS: readonly WechatSettingsGroup[] = [
  "ai-settings",
  "wechat-ops",
  "system-advanced",
]

/** 齿轮设置 Modal 二级 Tab */
export type WechatSettingsTab =
  | "llm-config"
  | "embedding"
  | "web-search"
  | "brain-kb"
  | "brain-persona"
  | "brain-routing"
  | "customer-types"
  | "about"
  /** @deprecated migrated in normalizeWechatSettingsTab */
  | "output"
  | "source-watch"
  | "scheduled-import"
  | "wechat-connect"
  | "cococat"
  | "stack-service"
  | "stack-logs"
  | "interface"
  | "network"
  | "api-server"
  | "maintenance"
  | "memory"
  | "bridge"
  | "agent"
  | "brain"

export function normalizeWechatSettingsTab(
  tab?: WechatSettingsTab | string | null,
): WechatSettingsTab {
  switch (tab) {
    case "brain":
    case "brain-kb":
      return "customer-types"
    case "brain-persona":
    case "brain-routing":
    case "customer-types":
    case "llm-config":
    case "embedding":
    case "web-search":
    case "about":
      return tab
    case "cococat":
    case "stack-service":
    case "stack-logs":
    case "wechat-connect":
      return "about"
    default:
      return "llm-config"
  }
}

export function brainTabFromSettingsTab(tab: WechatSettingsTab): BrainTab | null {
  if (tab === "brain-kb") return "kb"
  if (tab === "brain-persona") return "persona"
  if (tab === "brain-routing") return "routing"
  if (tab === "brain") return "kb"
  return null
}

export function settingsTabForBrainTab(tab: BrainTab): WechatSettingsTab {
  if (tab === "kb") return "brain-kb"
  if (tab === "persona") return "brain-persona"
  return "brain-routing"
}

export function brainTabToKnowledgeTab(tab: BrainTab): KnowledgeShellTab {
  return tab
}

export function knowledgeTabToBrainTab(
  tab: KnowledgeShellTab,
): BrainTab | null {
  if (tab === "search") return null
  return tab
}

export type SystemPanel =
  | "services"
  | "program"
  | "models"
  | "wiki"
  | "knowledge"
  | "logs"
  | "advanced"
export type SystemAdvancedTab = "interface" | "memory" | "bridge" | "agent"

export type WeChatTab = "connect" | "desktop" | "chats"
export type InboxListFilter = "all" | "todo" | "mute"
export type StackTab = "service" | "logs"
export type MemoryTab = "overview" | "playground"
export type AgentTab = "persona" | "chats" | "bridge" | "escalation"
export type WikiTab = "wiki" | "sources" | "search" | "lint" | "review"
export type SettingsGroup = "cococat" | "wiki" | "system"

export const BRAIN_TABS: readonly BrainTab[] = ["kb", "persona", "routing"]
export const SYSTEM_PANELS: readonly SystemPanel[] = [
  "services",
  "program",
  "models",
  "wiki",
  "knowledge",
  "logs",
  "advanced",
]
export const SYSTEM_ADVANCED_TABS: readonly SystemAdvancedTab[] = [
  "interface",
  "memory",
  "bridge",
  "agent",
]

export const WECHAT_TABS: readonly WeChatTab[] = ["connect", "desktop", "chats"]
export const STACK_TABS: readonly StackTab[] = ["service", "logs"]
export const MEMORY_TABS: readonly MemoryTab[] = ["overview", "playground"]
export const AGENT_TABS: readonly AgentTab[] = [
  "persona",
  "chats",
  "bridge",
  "escalation",
]
export const WIKI_TABS: readonly WikiTab[] = [
  "wiki",
  "sources",
  "search",
  "lint",
  "review",
]
export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  "cococat",
  "wiki",
  "system",
]

const LEGACY_MODULES = [
  "wechat",
  "wiki",
  "agent",
  "memory",
  "stack",
  "settings",
] as const

export type LegacyConsoleModule = (typeof LEGACY_MODULES)[number]

export type MigrationResult = {
  module: ConsoleModule
  brainTab?: BrainTab
  systemPanel?: SystemPanel
}

/**
 * Upgrade migration: retire v1 full-screen `wiki` module → v2 brain/kb.
 */
export function migrateLegacyModule(raw: string | null): MigrationResult {
  if (!raw) {
    return { module: "overview" }
  }

  if (raw === "wiki") {
    return { module: "brain", brainTab: "kb" }
  }

  switch (raw) {
    case "wechat":
      return { module: "inbox" }
    case "agent":
    case "memory":
      return { module: "brain", brainTab: "persona" }
    case "stack":
      return { module: "system", systemPanel: "services" }
    case "settings":
      return { module: "system", systemPanel: "program" }
    case "overview":
    case "inbox":
    case "brain":
    case "system":
      return { module: raw }
    default:
      return { module: "overview" }
  }
}

/** Persist Phase 6A reroute when localStorage still holds legacy `wiki`. */
export function migrateStoredActiveModule(raw: string | null): ConsoleModule {
  if (
    raw === "overview" ||
    raw === "inbox" ||
    raw === "brain" ||
    raw === "system"
  ) {
    return raw
  }
  const migrated = migrateLegacyModule(raw)
  try {
    localStorage.setItem(LAYOUT_KEYS.activeModule, migrated.module)
    if (migrated.brainTab) {
      saveStoredTab(LAYOUT_KEYS.brainTab, migrated.brainTab)
    }
    if (migrated.systemPanel) {
      saveStoredTab(LAYOUT_KEYS.systemPanel, migrated.systemPanel)
    }
  } catch {
    // ignore
  }
  return migrated.module
}

export function loadStoredTab<T extends string>(
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw && (allowed as readonly string[]).includes(raw)) {
      return raw as T
    }
  } catch {
    // ignore
  }
  return fallback
}

/** 方案 A：原「高级 · Wiki 专家」迁到独立「知识库」面板 */
export function migrateSystemLayoutV2(): void {
  try {
    const migratedKey = "cococat.system.v2PanelMigrated"
    if (localStorage.getItem(migratedKey) === "1") return
    const advTab = localStorage.getItem(LAYOUT_KEYS.systemAdvancedTab)
    if (advTab === "wiki") {
      saveStoredTab(LAYOUT_KEYS.systemPanel, "knowledge")
      saveStoredTab(LAYOUT_KEYS.systemAdvancedTab, "interface")
    }
    localStorage.setItem(migratedKey, "1")
  } catch {
    // ignore
  }
}

/** Split legacy「Wiki 与模型」panel → wiki + models. */
export function migrateSystemPanelSplit(): void {
  try {
    const migratedKey = "cococat.system.wikiModelsSplitMigrated"
    if (localStorage.getItem(migratedKey) === "1") return
    const panel = localStorage.getItem(LAYOUT_KEYS.systemPanel)
    if (panel === "wikiModels") {
      saveStoredTab(LAYOUT_KEYS.systemPanel, "wiki")
    }
    localStorage.setItem(migratedKey, "1")
  } catch {
    // ignore
  }
}

export function saveStoredTab(key: string, tab: string): void {
  try {
    localStorage.setItem(key, tab)
  } catch {
    // ignore
  }
}

/** Blocker states override remembered WeChat tab (PLAN §2.3). */
export function resolveWeChatTab(opts: {
  stored: WeChatTab
  driverUp: boolean
  loggedIn: boolean
}): WeChatTab {
  if (!opts.driverUp || !opts.loggedIn) return "connect"
  return opts.stored
}

export function defaultWeChatTab(driverUp: boolean, loggedIn: boolean): WeChatTab {
  if (!driverUp || !loggedIn) return "connect"
  return loadStoredTab(LAYOUT_KEYS.wechatTab, WECHAT_TABS, "desktop")
}

export function defaultMemoryTab(memoryUp: boolean): MemoryTab {
  if (!memoryUp) return "overview"
  return loadStoredTab(LAYOUT_KEYS.memoryTab, MEMORY_TABS, "playground")
}

export function migrateLegacyModuleToWechatTab(
  module: ConsoleModule,
): WechatShellTab {
  void module
  return "chats"
}

/** ai-lab Tab 已移除 → 默认聊天 */
export function migrateAiLabShellTab(): void {
  try {
    const key = "cococat.wechat.aiLabRemovedMigrated"
    if (localStorage.getItem(key) === "1") return
    const raw = localStorage.getItem(LAYOUT_KEYS.wechatShellTab)
    if (raw === "ai-lab") {
      saveStoredTab(LAYOUT_KEYS.wechatShellTab, "chats")
    }
    localStorage.setItem(key, "1")
  } catch {
    // ignore
  }
}

/** v3：四区 Console → 微信壳层 Tab */
export function migrateWechatShellLayout(): void {
  try {
    if (localStorage.getItem(LAYOUT_KEYS.wechatShellMigrated) === "1") return
    const raw = localStorage.getItem(LAYOUT_KEYS.activeModule)
    const module = migrateStoredActiveModule(raw)
    const tab = migrateLegacyModuleToWechatTab(module)
    saveStoredTab(LAYOUT_KEYS.wechatShellTab, tab)
    localStorage.setItem(LAYOUT_KEYS.wechatShellMigrated, "1")
  } catch {
    // ignore
  }
}

export function loadWechatShellTab(): WechatShellTab {
  migrateWechatShellLayout()
  migrateAiLabShellTab()
  return loadStoredTab(LAYOUT_KEYS.wechatShellTab, WECHAT_SHELL_TABS, "chats")
}

export function saveWechatShellTab(tab: WechatShellTab): void {
  saveStoredTab(LAYOUT_KEYS.wechatShellTab, tab)
}
