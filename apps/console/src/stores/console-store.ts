import { create } from "zustand"
import {
  LAYOUT_KEYS,
  migrateLegacyModule,
  migrateStoredActiveModule,
  migrateSystemLayoutV2,
  migrateSystemPanelSplit,
  migrateWechatShellLayout,
  saveStoredTab,
  saveWechatShellTab,
  loadStoredTab,
  loadWechatShellTab,
  type AgentTab,
  type BrainTab,
  type ConsoleModule,
  type InboxListFilter,
  type KnowledgeShellTab,
  type MemoryTab,
  type SettingsGroup,
  type StackTab,
  type SystemAdvancedTab,
  type SystemPanel,
  type WeChatTab,
  type WechatSettingsGroup,
  type WechatSettingsTab,
  type WechatShellTab,
  normalizeWechatSettingsTab,
  settingsTabForBrainTab,
} from "@/lib/console-layout"
import { openWechatVncInBrowser } from "@/lib/wechat-vnc"
import type { StackService } from "@/lib/stack-client"
import { wikiSaveRegistry } from "@/lib/wiki-file-save-registry"
import { useWikiStore } from "@/stores/wiki-store"

/** Deep-link options when navigating to Brain · 知识 */
export interface BrainKbDeepLinkOptions {
  wikiPath?: string
  topic?: string
  openInEditMode?: boolean
}

export type PendingKbDeepLink = {
  wikiPath: string | null
  topic: string | null
  openInEditMode: boolean
}

function runModuleMigration(): void {
  try {
    if (localStorage.getItem(LAYOUT_KEYS.activeModuleV2Migrated) === "1") {
      return
    }
    const raw = localStorage.getItem(LAYOUT_KEYS.activeModule)
    if (!raw) {
      localStorage.setItem(LAYOUT_KEYS.activeModule, "overview")
      localStorage.setItem(LAYOUT_KEYS.activeModuleV2Migrated, "1")
      return
    }
    if (
      raw === "overview" ||
      raw === "inbox" ||
      raw === "brain" ||
      raw === "system"
    ) {
      localStorage.setItem(LAYOUT_KEYS.activeModuleV2Migrated, "1")
      return
    }
    const migrated = migrateLegacyModule(raw)
    localStorage.setItem(LAYOUT_KEYS.activeModule, migrated.module)
    if (migrated.brainTab) {
      saveStoredTab(LAYOUT_KEYS.brainTab, migrated.brainTab)
    }
    if (migrated.systemPanel) {
      saveStoredTab(LAYOUT_KEYS.systemPanel, migrated.systemPanel)
    }
    localStorage.setItem(LAYOUT_KEYS.activeModuleV2Migrated, "1")
  } catch {
    // ignore
  }
}

function runStartupMigration(name: string, fn: () => void): void {
  try {
    fn()
  } catch (err) {
    console.error(`Console startup migration failed: ${name}`, err)
  }
}

runStartupMigration("module", runModuleMigration)
runStartupMigration("system-layout-v2", migrateSystemLayoutV2)
runStartupMigration("system-panel-split", migrateSystemPanelSplit)
runStartupMigration("wechat-shell-layout", migrateWechatShellLayout)

export type OpenSettingsModalOptions = {
  group?: WechatSettingsGroup
  tab?: WechatSettingsTab
  troubleshoot?: boolean
}

const SHELL_SETTINGS_TABS = new Set<WechatSettingsTab>([
  "llm-config",
  "embedding",
  "web-search",
  "brain-persona",
  "brain-routing",
  "customer-types",
  "about",
  "brain",
  "cococat",
  "stack-service",
  "stack-logs",
  "wechat-connect",
])

function normalizeSettingsTab(
  tab?: WechatSettingsTab,
  group?: WechatSettingsGroup,
): WechatSettingsTab {
  if (tab && SHELL_SETTINGS_TABS.has(tab)) {
    return normalizeWechatSettingsTab(tab)
  }
  if (group === "ai-settings") return "llm-config"
  if (group === "wechat-ops") return "customer-types"
  return "about"
}

function mapSystemPanelToSettings(
  panel?: SystemPanel,
  _stackTab?: StackTab | null,
): OpenSettingsModalOptions {
  if (panel === "models") {
    return { group: "ai-settings", tab: "llm-config" }
  }
  if (panel === "wiki" || panel === "knowledge") {
    return { group: "ai-settings", tab: "embedding" }
  }
  if (panel === "program") {
    return { group: "system-advanced", tab: "about" }
  }
  return { group: "system-advanced", tab: "about" }
}

function mapSettingsGroupToModal(
  group: SettingsGroup,
  category?: string | null,
): OpenSettingsModalOptions {
  if (category === "llm-config") {
    return { group: "ai-settings", tab: "llm-config" }
  }
  if (group === "wiki") {
    const tab = (category as WechatSettingsTab | undefined) ?? "embedding"
    if (tab === "web-search") {
      return { group: "ai-settings", tab: "web-search" }
    }
    return { group: "ai-settings", tab: "embedding" }
  }
  if (group === "cococat") {
    return { group: "system-advanced", tab: "about" }
  }
  if (category === "about") {
    return { group: "system-advanced", tab: "about" }
  }
  return { group: "system-advanced", tab: "about" }
}

function loadActiveModule(): ConsoleModule {
  try {
    const raw = localStorage.getItem(LAYOUT_KEYS.activeModule)
    return migrateStoredActiveModule(raw)
  } catch {
    // ignore
  }
  return "overview"
}

function persistModule(module: ConsoleModule) {
  try {
    localStorage.setItem(LAYOUT_KEYS.activeModule, module)
  } catch {
    // ignore
  }
}

async function navigateWithWikiFlush(action: () => void): Promise<void> {
  try {
    await wikiSaveRegistry.flushAll()
  } catch (err) {
    console.error("Wiki flush failed before navigation:", err)
  }
  action()
}

interface ConsoleState {
  activeModule: ConsoleModule
  activeWechatTab: WechatShellTab
  settingsModalOpen: boolean
  settingsModalGroup: WechatSettingsGroup
  settingsModalTab: WechatSettingsTab
  settingsModalTroubleshoot: boolean
  brainTab: BrainTab
  prefillSessionKey: string | null
  pendingWeChatTab: WeChatTab | null
  pendingWeChatChatId: string | null
  pendingContactUsername: string | null
  pendingAgentChatId: string | null
  pendingAgentTab: AgentTab | null
  pendingBrainTab: BrainTab | null
  pendingKnowledgeTab: KnowledgeShellTab | null
  pendingMemoryTab: MemoryTab | null
  pendingStackTab: StackTab | null
  pendingSystemPanel: SystemPanel | null
  pendingSettingsGroup: SettingsGroup | null
  pendingSettingsCategory: string | null
  pendingWechatTroubleshoot: boolean | null
  pendingSystemAdvancedTab: SystemAdvancedTab | null
  pendingInboxFilter: InboxListFilter | null
  pendingWikiPath: string | null
  pendingKbTopic: string | null
  pendingKbEditMode: boolean
  highlightStackService: StackService | null
  setActiveModule: (module: ConsoleModule) => void
  setActiveWechatTab: (tab: WechatShellTab) => void
  openSettingsModal: (opts?: OpenSettingsModalOptions) => void
  closeSettingsModal: () => void
  setBrainTab: (tab: BrainTab) => void
  navigateOverview: () => void
  navigateInbox: (tab?: WeChatTab, filter?: InboxListFilter) => void
  navigateInboxChat: (chatId: string) => void
  navigateContactProfile: (username: string) => void
  navigateBrain: (tab?: BrainTab, deepLink?: BrainKbDeepLinkOptions) => void
  navigateBrainChat: (chatId: string, tab?: AgentTab) => void
  navigateSystem: (panel?: SystemPanel, focusService?: StackService) => void
  /** 系统 · 服务 · 微信连接；troubleshoot 展开 noVNC 排障区 */
  navigateSystemWechat: (troubleshoot?: boolean) => void
  navigateSystemAdvanced: (tab?: SystemAdvancedTab) => void
  navigateSystemKnowledge: () => void
  /** 系统 · 模型 — 统一 LLM 配置 */
  navigateSystemModels: () => void
  navigateSettings: (group: SettingsGroup, category?: string) => void
  /** @deprecated use navigateInbox */
  navigateWeChat: (tab: WeChatTab) => void
  /** @deprecated use navigateInboxChat */
  navigateWeChatChat: (chatId: string) => void
  /** @deprecated use navigateSystem */
  navigateStack: (tab: StackTab, focusService?: StackService) => void
  clearStackNavigation: () => void
  clearWeChatNavigation: () => void
  /** 系统 · 高级 · Memory；默认 overview（完整 L3 SSOT） */
  openMemoryWithSession: (chatId: string, tab?: MemoryTab) => void
  /** @deprecated use navigateBrainChat */
  openAgentWithSession: (chatId: string) => void
  consumePrefillSessionKey: () => string | null
  consumePendingWeChatChatId: () => string | null
  consumePendingContactUsername: () => string | null
  consumePendingAgentChatId: () => string | null
  consumePendingAgentTab: () => AgentTab | null
  consumePendingBrainTab: () => BrainTab | null
  consumePendingKnowledgeTab: () => KnowledgeShellTab | null
  consumePendingSystemPanel: () => SystemPanel | null
  consumePendingMemoryTab: () => MemoryTab | null
  consumePendingSettingsNavigation: () => {
    group: SettingsGroup | null
    category: string | null
  }
  consumePendingWechatTroubleshoot: () => boolean
  consumePendingSystemAdvancedTab: () => SystemAdvancedTab | null
  consumePendingInboxFilter: () => InboxListFilter | null
  consumePendingKb: () => PendingKbDeepLink
  hasPendingKbDeepLink: () => boolean
}

export type { ConsoleModule, WechatShellTab }

export const useConsoleStore = create<ConsoleState>((set, get) => ({
  activeModule: loadActiveModule(),
  activeWechatTab: loadWechatShellTab(),
  settingsModalOpen: false,
  settingsModalGroup: "system-advanced",
  settingsModalTab: "llm-config",
  settingsModalTroubleshoot: false,
  brainTab: loadStoredTab(LAYOUT_KEYS.brainTab, ["kb", "persona", "routing"], "persona"),
  prefillSessionKey: null,
  pendingWeChatTab: null,
  pendingWeChatChatId: null,
  pendingContactUsername: null,
  pendingAgentChatId: null,
  pendingAgentTab: null,
  pendingBrainTab: null,
  pendingKnowledgeTab: null,
  pendingMemoryTab: null,
  pendingStackTab: null,
  pendingSystemPanel: null,
  pendingSettingsGroup: null,
  pendingSettingsCategory: null,
  pendingWechatTroubleshoot: null,
  pendingSystemAdvancedTab: null,
  pendingInboxFilter: null,
  pendingWikiPath: null,
  pendingKbTopic: null,
  pendingKbEditMode: false,
  highlightStackService: null,

  setActiveModule: (activeModule) => {
    void navigateWithWikiFlush(() => {
      persistModule(activeModule)
      const tab =
        activeModule === "inbox" || activeModule === "overview"
          ? "chats"
          : get().activeWechatTab === "contacts"
            ? "contacts"
            : "chats"
      saveWechatShellTab(tab)
      set({ activeModule, activeWechatTab: tab })
    })
  },

  setActiveWechatTab: (activeWechatTab) => {
    void navigateWithWikiFlush(() => {
      persistModule("inbox")
      saveWechatShellTab(activeWechatTab)
      set({ activeWechatTab, activeModule: "inbox" })
    })
  },

  openSettingsModal: (opts) => {
    void navigateWithWikiFlush(() => {
      const group = opts?.group ?? "system-advanced"
      const tab = normalizeSettingsTab(opts?.tab, group)
      set({
        settingsModalOpen: true,
        settingsModalGroup: group,
        settingsModalTab: tab,
        settingsModalTroubleshoot: opts?.troubleshoot ?? false,
        pendingWechatTroubleshoot: opts?.troubleshoot ? true : null,
      })
    })
  },

  closeSettingsModal: () => {
    set({ settingsModalOpen: false, settingsModalTroubleshoot: false })
  },

  setBrainTab: (brainTab) => {
    saveStoredTab(LAYOUT_KEYS.brainTab, brainTab)
    set({ brainTab })
  },

  navigateOverview: () => {
    get().setActiveWechatTab("chats")
  },

  navigateInbox: (tab, filter) => {
    void navigateWithWikiFlush(() => {
      persistModule("inbox")
      saveWechatShellTab("chats")
      set({
        activeModule: "inbox",
        activeWechatTab: "chats",
        pendingWeChatTab: tab ?? null,
        pendingInboxFilter: filter ?? null,
      })
    })
  },

  navigateInboxChat: (chatId) => {
    void navigateWithWikiFlush(() => {
      persistModule("inbox")
      saveWechatShellTab("chats")
      set({
        activeModule: "inbox",
        activeWechatTab: "chats",
        pendingWeChatTab: "chats",
        pendingWeChatChatId: chatId,
      })
    })
  },

  navigateContactProfile: (username) => {
    void navigateWithWikiFlush(() => {
      persistModule("inbox")
      saveWechatShellTab("contacts")
      set({
        activeModule: "inbox",
        activeWechatTab: "contacts",
        pendingContactUsername: username.trim() || null,
      })
    })
  },

  navigateBrain: (tab, deepLink) => {
    void navigateWithWikiFlush(() => {
      const nextTab = tab ?? get().brainTab ?? "kb"
      saveStoredTab(LAYOUT_KEYS.brainTab, nextTab)

      if (nextTab === "persona" || nextTab === "routing") {
        set({
          activeModule: "inbox",
          brainTab: nextTab,
          pendingBrainTab: nextTab,
          settingsModalOpen: true,
          settingsModalGroup: "wechat-ops",
          settingsModalTab: settingsTabForBrainTab(nextTab),
        })
        return
      }

      const hasDeepLink =
        !!deepLink?.wikiPath?.trim() ||
        !!deepLink?.topic?.trim() ||
        deepLink?.openInEditMode === true
      set({
        activeModule: "inbox",
        activeWechatTab: "kb",
        brainTab: "kb",
        pendingKnowledgeTab: "kb",
        pendingBrainTab: "kb",
        settingsModalOpen: false,
        ...(hasDeepLink
          ? {
              pendingWikiPath: deepLink?.wikiPath?.trim() ?? null,
              pendingKbTopic: deepLink?.topic?.trim() ?? null,
              pendingKbEditMode: deepLink?.openInEditMode ?? false,
            }
          : {
              pendingWikiPath: null,
              pendingKbTopic: null,
              pendingKbEditMode: false,
            }),
      })
    })
  },

  navigateBrainChat: (chatId, tab = "chats") => {
    void navigateWithWikiFlush(() => {
      set({
        activeModule: "inbox",
        brainTab: "persona",
        pendingBrainTab: "persona",
        pendingAgentChatId: chatId,
        pendingAgentTab: tab,
        settingsModalOpen: true,
        settingsModalGroup: "wechat-ops",
        settingsModalTab: settingsTabForBrainTab("persona"),
      })
    })
  },

  navigateSystem: (panel, focusService) => {
    const mapped = mapSystemPanelToSettings(panel)
    void navigateWithWikiFlush(() => {
      persistModule("system")
      if (panel) saveStoredTab(LAYOUT_KEYS.systemPanel, panel)
      set({
        activeModule: "system",
        pendingSystemPanel: panel ?? null,
        pendingStackTab: panel === "logs" ? "logs" : "service",
        highlightStackService: focusService ?? null,
        settingsModalOpen: true,
        settingsModalGroup: mapped.group ?? "system-advanced",
        settingsModalTab: mapped.tab ?? "about",
      })
    })
  },

  navigateSystemWechat: (troubleshoot = false) => {
    void openWechatVncInBrowser()
    if (troubleshoot) {
      console.info("[wechat] opened noVNC in browser for troubleshoot")
    }
  },

  navigateSystemAdvanced: (tab = "interface") => {
    if (tab === "memory") {
      get().navigateBrain("persona")
      return
    }
    if (tab === "bridge" || tab === "agent") {
      get().navigateBrain("routing")
      return
    }
    get().openSettingsModal({ group: "system-advanced", tab: "about" })
  },

  navigateSystemKnowledge: () => {
    useWikiStore.getState().setActiveView("wiki")
    get().navigateBrain("kb")
  },

  navigateSystemModels: () => {
    get().openSettingsModal({ group: "ai-settings", tab: "llm-config" })
  },

  navigateSettings: (group, category) => {
    const mapped = mapSettingsGroupToModal(group, category)
    get().openSettingsModal(mapped)
  },

  navigateWeChat: (tab) => {
    get().navigateInbox(tab)
  },

  navigateWeChatChat: (chatId) => {
    get().navigateInboxChat(chatId)
  },

  navigateStack: (tab, focusService) => {
    const panel: SystemPanel = tab === "logs" ? "logs" : "services"
    get().navigateSystem(panel, focusService)
  },

  clearStackNavigation: () => {
    set({
      pendingStackTab: null,
      pendingSystemPanel: null,
      highlightStackService: null,
    })
  },

  clearWeChatNavigation: () => {
    set({ pendingWeChatTab: null })
  },

  openMemoryWithSession: (chatId) => {
    get().navigateBrain("persona")
    void navigateWithWikiFlush(() => {
      set({ prefillSessionKey: chatId })
    })
  },

  openAgentWithSession: (chatId) => {
    get().navigateBrainChat(chatId, "chats")
  },

  consumePrefillSessionKey: () => {
    const key = get().prefillSessionKey
    if (key) set({ prefillSessionKey: null })
    return key
  },

  consumePendingWeChatChatId: () => {
    const id = get().pendingWeChatChatId
    if (id) set({ pendingWeChatChatId: null })
    return id
  },

  consumePendingContactUsername: () => {
    const username = get().pendingContactUsername
    if (username) set({ pendingContactUsername: null })
    return username
  },

  consumePendingAgentChatId: () => {
    const id = get().pendingAgentChatId
    if (id) set({ pendingAgentChatId: null })
    return id
  },

  consumePendingAgentTab: () => {
    const tab = get().pendingAgentTab
    if (tab) set({ pendingAgentTab: null })
    return tab
  },

  consumePendingBrainTab: () => {
    const tab = get().pendingBrainTab
    if (tab) set({ pendingBrainTab: null })
    return tab
  },

  consumePendingKnowledgeTab: () => {
    const tab = get().pendingKnowledgeTab
    if (tab) set({ pendingKnowledgeTab: null })
    return tab
  },

  consumePendingSystemPanel: () => {
    const panel = get().pendingSystemPanel
    if (panel) set({ pendingSystemPanel: null })
    return panel
  },

  consumePendingMemoryTab: () => {
    const tab = get().pendingMemoryTab
    if (tab) set({ pendingMemoryTab: null })
    return tab
  },

  consumePendingSettingsNavigation: () => {
    const group = get().pendingSettingsGroup
    const category = get().pendingSettingsCategory
    if (group || category) {
      set({ pendingSettingsGroup: null, pendingSettingsCategory: null })
    }
    return { group, category }
  },

  consumePendingWechatTroubleshoot: () => {
    const v = get().pendingWechatTroubleshoot
    if (v) set({ pendingWechatTroubleshoot: null })
    return v ?? false
  },

  consumePendingSystemAdvancedTab: () => {
    const tab = get().pendingSystemAdvancedTab
    if (tab) set({ pendingSystemAdvancedTab: null })
    return tab
  },

  consumePendingInboxFilter: () => {
    const filter = get().pendingInboxFilter
    if (filter) set({ pendingInboxFilter: null })
    return filter
  },

  hasPendingKbDeepLink: () => {
    const { pendingWikiPath, pendingKbTopic, pendingKbEditMode } = get()
    return !!(
      pendingWikiPath?.trim() ||
      pendingKbTopic?.trim() ||
      pendingKbEditMode
    )
  },

  consumePendingKb: () => {
    const { pendingWikiPath, pendingKbTopic, pendingKbEditMode } = get()
    if (
      !pendingWikiPath?.trim() &&
      !pendingKbTopic?.trim() &&
      !pendingKbEditMode
    ) {
      return {
        wikiPath: null,
        topic: null,
        openInEditMode: false,
      }
    }
    set({
      pendingWikiPath: null,
      pendingKbTopic: null,
      pendingKbEditMode: false,
    })
    return {
      wikiPath: pendingWikiPath,
      topic: pendingKbTopic,
      openInEditMode: pendingKbEditMode,
    }
  },
}))
