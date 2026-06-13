/**
 * CocoCat Console layout — localStorage keys and tab persistence.
 * v2 壳层见 docs/PLAN-console-v2.md；底层 Tab 见 docs/PLAN-console-ux.md
 */

export const LAYOUT_KEYS = {
  activeModule: "cococat.console.activeModule",
  activeModuleV2Migrated: "cococat.console.v2ModuleMigrated",
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

export type BrainTab = "kb" | "persona" | "routing"
export type SystemPanel =
  | "services"
  | "program"
  | "wikiModels"
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
  "wikiModels",
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
