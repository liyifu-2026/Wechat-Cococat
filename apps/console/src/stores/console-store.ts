import { create } from "zustand"
import {
  LAYOUT_KEYS,
  migrateLegacyModule,
  migrateStoredActiveModule,
  migrateSystemLayoutV2,
  saveStoredTab,
  loadStoredTab,
  type AgentTab,
  type BrainTab,
  type ConsoleModule,
  type InboxListFilter,
  type MemoryTab,
  type SettingsGroup,
  type StackTab,
  type SystemAdvancedTab,
  type SystemPanel,
  type WeChatTab,
} from "@/lib/console-layout"
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

runModuleMigration()
migrateSystemLayoutV2()

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
  await wikiSaveRegistry.flushAll()
  action()
}

interface ConsoleState {
  activeModule: ConsoleModule
  brainTab: BrainTab
  prefillSessionKey: string | null
  pendingWeChatTab: WeChatTab | null
  pendingWeChatChatId: string | null
  pendingAgentChatId: string | null
  pendingAgentTab: AgentTab | null
  pendingBrainTab: BrainTab | null
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
  setBrainTab: (tab: BrainTab) => void
  navigateOverview: () => void
  navigateInbox: (tab?: WeChatTab, filter?: InboxListFilter) => void
  navigateInboxChat: (chatId: string) => void
  navigateBrain: (tab?: BrainTab, deepLink?: BrainKbDeepLinkOptions) => void
  navigateBrainChat: (chatId: string, tab?: AgentTab) => void
  navigateSystem: (panel?: SystemPanel, focusService?: StackService) => void
  /** 系统 · 服务 · 微信连接；troubleshoot 展开 noVNC 排障区 */
  navigateSystemWechat: (troubleshoot?: boolean) => void
  navigateSystemAdvanced: (tab?: SystemAdvancedTab) => void
  navigateSystemKnowledge: () => void
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
  consumePendingAgentChatId: () => string | null
  consumePendingAgentTab: () => AgentTab | null
  consumePendingBrainTab: () => BrainTab | null
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

export type { ConsoleModule }

export const useConsoleStore = create<ConsoleState>((set, get) => ({
  activeModule: loadActiveModule(),
  brainTab: loadStoredTab(LAYOUT_KEYS.brainTab, ["kb", "persona", "routing"], "persona"),
  prefillSessionKey: null,
  pendingWeChatTab: null,
  pendingWeChatChatId: null,
  pendingAgentChatId: null,
  pendingAgentTab: null,
  pendingBrainTab: null,
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
      set({ activeModule })
    })
  },

  setBrainTab: (brainTab) => {
    saveStoredTab(LAYOUT_KEYS.brainTab, brainTab)
    set({ brainTab })
  },

  navigateOverview: () => {
    void navigateWithWikiFlush(() => {
      persistModule("overview")
      set({ activeModule: "overview" })
    })
  },

  navigateInbox: (tab, filter) => {
    void navigateWithWikiFlush(() => {
      persistModule("inbox")
      set({
        activeModule: "inbox",
        pendingWeChatTab: tab ?? null,
        pendingInboxFilter: filter ?? null,
      })
    })
  },

  navigateInboxChat: (chatId) => {
    void navigateWithWikiFlush(() => {
      persistModule("inbox")
      set({
        activeModule: "inbox",
        pendingWeChatTab: "chats",
        pendingWeChatChatId: chatId,
      })
    })
  },

  navigateBrain: (tab, deepLink) => {
    void navigateWithWikiFlush(() => {
      persistModule("brain")
      const nextTab = tab ?? get().brainTab
      if (tab) saveStoredTab(LAYOUT_KEYS.brainTab, tab)
      const hasDeepLink =
        !!deepLink?.wikiPath?.trim() ||
        !!deepLink?.topic?.trim() ||
        deepLink?.openInEditMode === true
      set({
        activeModule: "brain",
        brainTab: nextTab,
        pendingBrainTab: tab ?? null,
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
      persistModule("brain")
      set({
        activeModule: "brain",
        brainTab: "persona",
        pendingAgentChatId: chatId,
        pendingAgentTab: tab,
      })
    })
  },

  navigateSystem: (panel, focusService) => {
    void navigateWithWikiFlush(() => {
      persistModule("system")
      const stackTab: StackTab =
        panel === "logs" ? "logs" : "service"
      if (panel) saveStoredTab(LAYOUT_KEYS.systemPanel, panel)
      set({
        activeModule: "system",
        pendingSystemPanel: panel ?? null,
        pendingStackTab: stackTab,
        highlightStackService: focusService ?? null,
      })
    })
  },

  navigateSystemWechat: (troubleshoot = false) => {
    void navigateWithWikiFlush(() => {
      persistModule("system")
      saveStoredTab(LAYOUT_KEYS.systemPanel, "services")
      set({
        activeModule: "system",
        pendingSystemPanel: "services",
        pendingStackTab: "service",
        highlightStackService: "driver",
        pendingWechatTroubleshoot: troubleshoot ? true : null,
      })
    })
  },

  navigateSystemAdvanced: (tab = "interface") => {
    void navigateWithWikiFlush(() => {
      persistModule("system")
      saveStoredTab(LAYOUT_KEYS.systemPanel, "advanced")
      saveStoredTab(LAYOUT_KEYS.systemAdvancedTab, tab)
      set({
        activeModule: "system",
        pendingSystemPanel: "advanced",
        pendingSystemAdvancedTab: tab,
      })
    })
  },

  navigateSystemKnowledge: () => {
    useWikiStore.getState().setActiveView("wiki")
    get().navigateSystem("knowledge")
  },

  navigateSettings: (group, category) => {
    void navigateWithWikiFlush(() => {
      persistModule("system")
      if (group === "system") {
        saveStoredTab(LAYOUT_KEYS.systemPanel, "advanced")
        saveStoredTab(LAYOUT_KEYS.systemAdvancedTab, "interface")
        set({
          activeModule: "system",
          pendingSystemPanel: "advanced",
          pendingSystemAdvancedTab: "interface",
          pendingSettingsGroup: null,
          pendingSettingsCategory: category ?? null,
        })
        return
      }
      if (group === "wiki") {
        saveStoredTab(LAYOUT_KEYS.systemPanel, "wikiModels")
        set({
          activeModule: "system",
          pendingSystemPanel: "wikiModels",
          pendingSettingsGroup: "wiki",
          pendingSettingsCategory: category ?? null,
        })
        return
      }
      saveStoredTab(LAYOUT_KEYS.systemPanel, "program")
      set({
        activeModule: "system",
        pendingSystemPanel: "program",
        pendingSettingsGroup: group,
        pendingSettingsCategory: category ?? null,
      })
    })
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

  openMemoryWithSession: (chatId, tab = "overview") => {
    void navigateWithWikiFlush(() => {
      persistModule("system")
      saveStoredTab(LAYOUT_KEYS.systemPanel, "advanced")
      saveStoredTab(LAYOUT_KEYS.systemAdvancedTab, "memory")
      set({
        activeModule: "system",
        pendingSystemPanel: "advanced",
        pendingSystemAdvancedTab: "memory",
        prefillSessionKey: chatId,
        pendingMemoryTab: tab,
      })
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
