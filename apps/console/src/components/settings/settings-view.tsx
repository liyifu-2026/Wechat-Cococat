import { useCallback, useEffect, useMemo, useState, lazy, Suspense } from "react"
import {
  Bot,
  Binary,
  Globe,
  Languages,
  Palette,
  Info,
  Network,
  Wrench,
  Clock,
  FolderSync,
  Server,
  Cat,
  Search,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { invoke } from "@tauri-apps/api/core"
import i18n from "@/i18n"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { ModuleTabs } from "@/components/console/module-tabs"
import { useModuleTab } from "@/hooks/use-module-tab"
import { useWikiStore } from "@/stores/wiki-store"
import { useConsoleStore } from "@/stores/console-store"
import { useChatStore } from "@/stores/chat-store"
import { loadSourceWatchConfig, saveLanguage } from "@/lib/project-store"
import {
  LAYOUT_KEYS,
  SETTINGS_GROUPS,
  loadStoredTab,
  saveStoredTab,
  type SettingsGroup,
} from "@/lib/console-layout"
import type { SettingsDraft, DraftSetter } from "./settings-types"
import { normalizeSourceWatchConfig } from "@/lib/source-watch-config"
import { EmbeddingSection } from "./sections/embedding-section"
import { WebSearchSection } from "./sections/web-search-section"
import { OutputSection } from "./sections/output-section"
import { InterfaceSection } from "./sections/interface-section"
import { NetworkSection } from "./sections/network-section"
import { ScheduledImportSection } from "./sections/scheduled-import-section"
import { SourceWatchSection } from "./sections/source-watch-section"
import { ApiServerSection } from "./sections/api-server-section"
import { MaintenanceSection } from "./sections/maintenance-section"
import { AboutSection } from "./sections/about-section"
import { CococatSettingsSection } from "./sections/cococat-settings-section"

const LlmConfigView = lazy(() =>
  import("./llm-config/llm-config-view").then((m) => ({ default: m.LlmConfigView })),
)

export type SettingsCategoryId =
  | "llm-config"
  | "cococat"
  | "embedding"
  | "web-search"
  | "network"
  | "source-watch"
  | "scheduled-import"
  | "api-server"
  | "output"
  | "interface"
  | "maintenance"
  | "about"

type CategoryId = SettingsCategoryId

interface CategoryMeta {
  id: CategoryId
  labelKey: string
  icon: typeof Bot
  group: SettingsGroup
  searchKeywords?: string[]
}

const CATEGORY_META: CategoryMeta[] = [
  {
    id: "llm-config",
    labelKey: "settings.categories.llmConfig",
    icon: Bot,
    group: "cococat",
    searchKeywords: ["llm", "model", "mimo", "api", "agent", "wiki", "模型", "厂商", "caption", "图片描述", "ingest"],
  },
  {
    id: "cococat",
    labelKey: "settings.categories.cococat",
    icon: Cat,
    group: "cococat",
    searchKeywords: ["token", "path", "driver", "agent", "memory"],
  },
  {
    id: "embedding",
    labelKey: "settings.categories.embedding",
    icon: Binary,
    group: "wiki",
    searchKeywords: ["vector", "gemini"],
  },
  {
    id: "web-search",
    labelKey: "settings.categories.webSearch",
    icon: Globe,
    group: "wiki",
    searchKeywords: ["tavily", "serp", "search"],
  },
  {
    id: "output",
    labelKey: "settings.categories.output",
    icon: Languages,
    group: "wiki",
    searchKeywords: ["language", "output"],
  },
  {
    id: "source-watch",
    labelKey: "settings.categories.sourceWatch",
    icon: FolderSync,
    group: "wiki",
    searchKeywords: ["watch", "folder", "sync"],
  },
  {
    id: "scheduled-import",
    labelKey: "settings.categories.scheduledImport",
    icon: Clock,
    group: "wiki",
    searchKeywords: ["import", "schedule", "cron"],
  },
  {
    id: "interface",
    labelKey: "settings.categories.interface",
    icon: Palette,
    group: "system",
    searchKeywords: ["theme", "dark", "language", "ui"],
  },
  {
    id: "network",
    labelKey: "settings.categories.network",
    icon: Network,
    group: "system",
    searchKeywords: ["proxy", "代理", "http"],
  },
  {
    id: "api-server",
    labelKey: "settings.categories.apiServer",
    icon: Server,
    group: "system",
    searchKeywords: ["token", "api", "http", "19828"],
  },
  {
    id: "maintenance",
    labelKey: "settings.categories.maintenance",
    icon: Wrench,
    group: "system",
    searchKeywords: ["dedup", "merge", "cleanup"],
  },
  {
    id: "about",
    labelKey: "settings.categories.about",
    icon: Info,
    group: "system",
    searchKeywords: ["version"],
  },
]

const ALL_CATEGORY_IDS = CATEGORY_META.map((c) => c.id)

const GROUP_DEFAULT_CATEGORY: Record<SettingsGroup, CategoryId> = {
  cococat: "cococat",
  wiki: "embedding",
  system: "interface",
}

function categoriesForGroup(
  group: SettingsGroup,
  opts?: { hideLlmConfig?: boolean },
): CategoryMeta[] {
  const inGroup = CATEGORY_META.filter((c) => c.group === group)
  if (opts?.hideLlmConfig) {
    return inGroup.filter((c) => c.id !== "llm-config")
  }
  return inGroup
}

function initialDraft(
  llm: ReturnType<typeof useWikiStore.getState>["llmConfig"],
  embed: ReturnType<typeof useWikiStore.getState>["embeddingConfig"],
  outputLanguage: ReturnType<typeof useWikiStore.getState>["outputLanguage"],
  proxy: ReturnType<typeof useWikiStore.getState>["proxyConfig"],
  scheduledImport: ReturnType<typeof useWikiStore.getState>["scheduledImportConfig"],
  sourceWatch: ReturnType<typeof useWikiStore.getState>["sourceWatchConfig"],
  apiConfig: ReturnType<typeof useWikiStore.getState>["apiConfig"],
  maxHistoryMessages: number,
  uiLanguage: string,
  projectPath?: string,
): SettingsDraft {
  let displayPath = scheduledImport.path || ""
  if (!displayPath && projectPath) {
    displayPath = `${projectPath}/raw/sources`
  } else if (
    displayPath &&
    projectPath &&
    !displayPath.startsWith("/") &&
    !displayPath.match(/^[a-zA-Z]:[/\\]/)
  ) {
    displayPath = `${projectPath}/${displayPath}`
  }

  return {
    provider: llm.provider,
    apiKey: llm.apiKey,
    model: llm.model,
    ollamaUrl: llm.ollamaUrl,
    customEndpoint: llm.customEndpoint,
    azureApiVersion: llm.azureApiVersion ?? "2024-10-21",
    azureModelFamily: llm.azureModelFamily ?? "auto",
    maxContextSize: llm.maxContextSize ?? 204800,
    apiMode: llm.apiMode,
    reasoning: llm.reasoning,
    embeddingEnabled: embed.enabled,
    embeddingEndpoint: embed.endpoint,
    embeddingApiKey: embed.apiKey,
    embeddingModel: embed.model,
    embeddingOutputDimensionality: embed.outputDimensionality,
    embeddingMaxChunkChars: embed.maxChunkChars,
    embeddingOverlapChunkChars: embed.overlapChunkChars,
    embeddingExtraHeaders: embed.extraHeaders ?? {},
    outputLanguage,
    maxHistoryMessages,
    proxyEnabled: proxy.enabled,
    proxyUrl: proxy.url,
    proxyBypassLocal: proxy.bypassLocal,
    scheduledImportEnabled: scheduledImport.enabled,
    scheduledImportPath: displayPath,
    scheduledImportInterval: scheduledImport.interval,
    sourceWatchConfig: normalizeSourceWatchConfig(sourceWatch),
    apiEnabled: apiConfig.enabled,
    apiAllowUnauthenticated: apiConfig.allowUnauthenticated,
    apiToken: apiConfig.token,
    uiLanguage,
  }
}

type SettingsViewProps = {
  embedded?: boolean
  lockedGroup?: SettingsGroup
  hideHeader?: boolean
  forcedCategory?: CategoryId
  hideSidebar?: boolean
  hideGroupTabs?: boolean
}

export function SettingsView({
  embedded = false,
  lockedGroup,
  hideHeader = false,
  forcedCategory,
  hideSidebar = false,
  hideGroupTabs = false,
}: SettingsViewProps = {}) {
  const { t } = useTranslation()
  const consumePendingSettingsNavigation = useConsoleStore(
    (s) => s.consumePendingSettingsNavigation,
  )
  const project = useWikiStore((s) => s.project)
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const setLlmConfig = useWikiStore((s) => s.setLlmConfig)
  const embeddingConfig = useWikiStore((s) => s.embeddingConfig)
  const setEmbeddingConfig = useWikiStore((s) => s.setEmbeddingConfig)
  const outputLanguage = useWikiStore((s) => s.outputLanguage)
  const setOutputLanguage = useWikiStore((s) => s.setOutputLanguage)
  const proxyConfig = useWikiStore((s) => s.proxyConfig)
  const setProxyConfig = useWikiStore((s) => s.setProxyConfig)
  const scheduledImportConfig = useWikiStore((s) => s.scheduledImportConfig)
  const setScheduledImportConfig = useWikiStore((s) => s.setScheduledImportConfig)
  const sourceWatchConfig = useWikiStore((s) => s.sourceWatchConfig)
  const setSourceWatchConfig = useWikiStore((s) => s.setSourceWatchConfig)
  const apiConfig = useWikiStore((s) => s.apiConfig)
  const setApiConfig = useWikiStore((s) => s.setApiConfig)
  const maxHistoryMessages = useChatStore((s) => s.maxHistoryMessages)
  const setMaxHistoryMessages = useChatStore((s) => s.setMaxHistoryMessages)

  const [activeCategory, setActiveCategory] = useState<CategoryId>(() =>
    loadStoredTab(LAYOUT_KEYS.settingsCategory, ALL_CATEGORY_IDS, "cococat"),
  )

  const initialGroup = useMemo(() => {
    const meta = CATEGORY_META.find((c) => c.id === activeCategory)
    return (
      meta?.group ??
      loadStoredTab(LAYOUT_KEYS.settingsGroup, SETTINGS_GROUPS, "cococat")
    )
  }, [activeCategory])

  const [activeGroup, setActiveGroup] = useModuleTab<SettingsGroup>({
    storageKey: LAYOUT_KEYS.settingsGroup,
    allowed: SETTINGS_GROUPS,
    defaultTab: lockedGroup ?? initialGroup,
    forcedTab: lockedGroup ?? null,
  })
  const [searchQuery, setSearchQuery] = useState("")
  const [saved, setSaved] = useState(false)
  const [draft, setDraftState] = useState<SettingsDraft>(() =>
    initialDraft(
      llmConfig,
      embeddingConfig,
      outputLanguage,
      proxyConfig,
      scheduledImportConfig,
      sourceWatchConfig,
      apiConfig,
      maxHistoryMessages,
      i18n.language,
      project?.path,
    ),
  )

  const setCategory = useCallback((id: CategoryId) => {
    setActiveCategory(id)
    saveStoredTab(LAYOUT_KEYS.settingsCategory, id)
    const meta = CATEGORY_META.find((c) => c.id === id)
    if (meta && meta.group !== activeGroup) {
      setActiveGroup(meta.group)
    }
  }, [activeGroup, setActiveGroup])

  useEffect(() => {
    if (!forcedCategory) return
    setActiveCategory(forcedCategory)
    saveStoredTab(LAYOUT_KEYS.settingsCategory, forcedCategory)
    const meta = CATEGORY_META.find((c) => c.id === forcedCategory)
    if (meta && meta.group !== activeGroup) {
      setActiveGroup(meta.group)
    }
  }, [forcedCategory, activeGroup, setActiveGroup])

  useEffect(() => {
    const inGroup = categoriesForGroup(activeGroup, {
      hideLlmConfig: !!lockedGroup,
    }).some((c) => c.id === activeCategory)
    if (!inGroup) {
      const fallback = GROUP_DEFAULT_CATEGORY[activeGroup]
      setActiveCategory(fallback)
      saveStoredTab(LAYOUT_KEYS.settingsCategory, fallback)
    }
  }, [activeGroup, activeCategory, lockedGroup])

  useEffect(() => {
    const { group, category } = consumePendingSettingsNavigation()
    if (group) setActiveGroup(group)
    if (category && (ALL_CATEGORY_IDS as readonly string[]).includes(category)) {
      setActiveCategory(category as CategoryId)
      saveStoredTab(LAYOUT_KEYS.settingsCategory, category)
    }
  }, [consumePendingSettingsNavigation, setActiveGroup])

  useEffect(() => {
    let cancelled = false
    loadSourceWatchConfig(project?.id).then((config) => {
      if (cancelled) return
      const normalized = normalizeSourceWatchConfig(config)
      setSourceWatchConfig(normalized)
      setDraftState((prev) => ({ ...prev, sourceWatchConfig: normalized }))
    }).catch(() => {
      if (cancelled) return
      const fallback = normalizeSourceWatchConfig()
      setSourceWatchConfig(fallback)
      setDraftState((prev) => ({ ...prev, sourceWatchConfig: fallback }))
    })
    return () => {
      cancelled = true
    }
  }, [project?.id, setSourceWatchConfig])

  useEffect(() => {
    setDraftState((prev) =>
      initialDraft(
        llmConfig,
        embeddingConfig,
        outputLanguage,
        proxyConfig,
        scheduledImportConfig,
        sourceWatchConfig,
        apiConfig,
        maxHistoryMessages,
        prev.uiLanguage,
        project?.path,
      ),
    )
  }, [
    llmConfig,
    embeddingConfig,
    outputLanguage,
    proxyConfig,
    scheduledImportConfig,
    sourceWatchConfig,
    apiConfig,
    maxHistoryMessages,
    project,
  ])

  const setDraft: DraftSetter = useCallback((key, value) => {
    setDraftState((prev) => ({ ...prev, [key]: value }))
  }, [])

  const handleSave = useCallback(async () => {
    const {
      saveLlmConfig,
      saveEmbeddingConfig,
      saveOutputLanguage,
      saveProxyConfig,
      saveScheduledImportConfig,
      saveSourceWatchConfig,
      saveApiConfig,
    } = await import("@/lib/project-store")

    const newLlm = {
      provider: draft.provider,
      apiKey: draft.apiKey,
      model: draft.model,
      ollamaUrl: draft.ollamaUrl,
      customEndpoint: draft.customEndpoint,
      azureApiVersion: draft.provider === "azure" ? draft.azureApiVersion.trim() : undefined,
      azureModelFamily: draft.provider === "azure" ? draft.azureModelFamily : undefined,
      maxContextSize: draft.maxContextSize,
      apiMode: draft.provider === "custom" ? draft.apiMode : undefined,
      reasoning: draft.reasoning,
    }
    const newEmbed = {
      enabled: draft.embeddingEnabled,
      endpoint: draft.embeddingEndpoint,
      apiKey: draft.embeddingApiKey,
      model: draft.embeddingModel,
      outputDimensionality: draft.embeddingOutputDimensionality,
      maxChunkChars: draft.embeddingMaxChunkChars,
      overlapChunkChars: draft.embeddingOverlapChunkChars,
      extraHeaders: draft.embeddingExtraHeaders,
    }
    const newProxy = {
      enabled: draft.proxyEnabled,
      url: draft.proxyUrl.trim(),
      bypassLocal: draft.proxyBypassLocal,
    }

    setLlmConfig(newLlm)
    await saveLlmConfig(newLlm)
    setEmbeddingConfig(newEmbed)
    await saveEmbeddingConfig(newEmbed)
    setOutputLanguage(draft.outputLanguage as typeof outputLanguage)
    await saveOutputLanguage(draft.outputLanguage as typeof outputLanguage, project?.id)
    setProxyConfig(newProxy)
    await saveProxyConfig(newProxy)
    const newSourceWatch = normalizeSourceWatchConfig(draft.sourceWatchConfig)
    setSourceWatchConfig(newSourceWatch)
    await saveSourceWatchConfig(newSourceWatch, project?.id)
    if (project) {
      const { startProjectFileSync, stopProjectFileSync } = await import("@/lib/project-file-sync")
      if (newSourceWatch.enabled) {
        await startProjectFileSync(project, newSourceWatch).catch((err) =>
          console.error("Failed to start project file sync:", err),
        )
      } else {
        await stopProjectFileSync()
      }
    }
    try {
      await invoke<string>("set_proxy_env", { config: newProxy })
    } catch (err) {
      console.warn("[proxy] live update failed; restart will still apply:", err)
    }

    const newScheduledImport = {
      enabled: draft.scheduledImportEnabled,
      path: draft.scheduledImportPath,
      interval: Math.max(1, Math.min(1440, draft.scheduledImportInterval || 60)),
      lastScan: scheduledImportConfig.lastScan,
    }
    setScheduledImportConfig(newScheduledImport)
    if (project) {
      await saveScheduledImportConfig(project.path, newScheduledImport)
      const { startScheduledImport, stopScheduledImport } = await import("@/lib/scheduled-import")
      if (
        newScheduledImport.enabled &&
        newScheduledImport.path &&
        newScheduledImport.interval > 0
      ) {
        startScheduledImport(project, newScheduledImport)
      } else {
        stopScheduledImport()
      }
    }

    setMaxHistoryMessages(draft.maxHistoryMessages)

    const newApiConfig = {
      enabled: draft.apiEnabled,
      allowUnauthenticated: draft.apiAllowUnauthenticated,
      token: draft.apiToken.trim(),
    }
    setApiConfig(newApiConfig)
    await saveApiConfig(newApiConfig)
    try {
      await invoke<string>("api_server_reload_config")
    } catch (err) {
      console.warn("[api] failed to reload API server config cache:", err)
    }

    if (draft.uiLanguage !== i18n.language) {
      await i18n.changeLanguage(draft.uiLanguage)
      await saveLanguage(draft.uiLanguage)
    }

    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }, [
    draft,
    project,
    setLlmConfig,
    setEmbeddingConfig,
    setOutputLanguage,
    setProxyConfig,
    setScheduledImportConfig,
    setSourceWatchConfig,
    setApiConfig,
    scheduledImportConfig,
    setMaxHistoryMessages,
    outputLanguage,
  ])

  const body = useMemo(() => {
    switch (activeCategory) {
      case "llm-config":
        return (
          <Suspense
            fallback={
              <div className="text-sm text-muted-foreground">Loading…</div>
            }
          >
            <LlmConfigView embedded={embedded} />
          </Suspense>
        )
      case "cococat":
        return <CococatSettingsSection />
      case "embedding":
        return <EmbeddingSection draft={draft} setDraft={setDraft} />
      case "web-search":
        return <WebSearchSection />
      case "network":
        return <NetworkSection draft={draft} setDraft={setDraft} />
      case "source-watch":
        return (
          <SourceWatchSection
            draft={draft}
            setDraft={setDraft}
            projectReady={!!project}
          />
        )
      case "scheduled-import":
        return <ScheduledImportSection draft={draft} setDraft={setDraft} />
      case "api-server":
        return <ApiServerSection draft={draft} setDraft={setDraft} />
      case "output":
        return <OutputSection draft={draft} setDraft={setDraft} />
      case "interface":
        return <InterfaceSection draft={draft} setDraft={setDraft} />
      case "maintenance":
        return <MaintenanceSection />
      case "about":
        return <AboutSection />
      default:
        return (
          <Suspense fallback={<div className="text-sm text-muted-foreground">Loading…</div>}>
            <LlmConfigView embedded={embedded} />
          </Suspense>
        )
    }
  }, [activeCategory, draft, setDraft, project])

  const visibleCategories = useMemo(() => {
    const groupCats = categoriesForGroup(activeGroup, {
      hideLlmConfig: !!lockedGroup,
    })
    const q = searchQuery.trim().toLowerCase()
    if (!q) return groupCats
    return groupCats.filter((c) => {
      const label = t(c.labelKey).toLowerCase()
      const keywords = (c.searchKeywords ?? []).join(" ").toLowerCase()
      return (
        label.includes(q) ||
        c.id.includes(q) ||
        keywords.includes(q)
      )
    })
  }, [activeGroup, searchQuery, t])

  const groupTabs = [
    { id: "cococat" as const, label: t("settings.groups.cococat") },
    { id: "wiki" as const, label: t("settings.groups.wiki") },
    { id: "system" as const, label: t("settings.groups.system") },
  ]

  const showSaveBar =
    activeCategory !== "about" &&
    activeCategory !== "llm-config" &&
    activeCategory !== "cococat"

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!embedded && (
        <div className="shrink-0 px-6 pb-0 pt-6">
          <h1 className="text-xl font-semibold">{t("settings.title")}</h1>
        </div>
      )}

      {embedded && !hideHeader && (
        <header className="shrink-0 border-b px-8 py-5">
          <h1 className="text-lg font-semibold">{t("console.system.panels.program")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("console.system.panelDesc.program")}
          </p>
        </header>
      )}

      {!lockedGroup && !hideGroupTabs && (
        <ModuleTabs
          tabs={groupTabs}
          active={activeGroup}
          onChange={setActiveGroup}
          ariaLabel={t("settings.title")}
        />
      )}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        {!hideSidebar && (
        <aside className="flex min-h-0 w-56 shrink-0 flex-col overflow-hidden border-r bg-muted/30">
          <div className="px-3 pb-2 pt-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("settings.searchPlaceholder")}
                className="h-8 pl-8 text-sm"
              />
            </div>
          </div>
          <nav className="console-scroll-container min-h-0 flex-1 overflow-y-auto px-2 pb-3">
            {visibleCategories.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">
                {t("settings.searchEmpty")}
              </p>
            ) : (
              visibleCategories.map((c) => {
                const Icon = c.icon
                const isActive = c.id === activeCategory
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setCategory(c.id)}
                    aria-current={isActive ? "page" : undefined}
                    className={`group mb-0.5 flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-sm transition-colors duration-150 ${
                      isActive
                        ? "bg-foreground/[0.08] font-medium text-foreground ring-1 ring-border/70"
                        : "text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 shrink-0 transition-colors ${
                        isActive
                          ? "text-primary"
                          : "text-muted-foreground/80 group-hover:text-accent-foreground"
                      }`}
                    />
                    <span className="truncate">{t(c.labelKey)}</span>
                  </button>
                )
              })
            )}
          </nav>
        </aside>
        )}

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="console-scroll-container min-h-0 flex-1 overflow-y-auto px-8 py-6">
            <div className="mx-auto max-w-2xl">{body}</div>
          </div>

          {showSaveBar && (
            <div className="shrink-0 border-t bg-background/80 px-8 py-3 backdrop-blur">
              <div className="mx-auto flex max-w-2xl items-center justify-between gap-4">
                <p className="text-xs text-muted-foreground">
                  {saved ? t("settings.savedTick") : t("settings.changeHint")}
                </p>
                <Button onClick={() => void handleSave()}>
                  {saved ? t("settings.saved") : t("settings.save")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
