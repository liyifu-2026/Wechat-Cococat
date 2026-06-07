import { useState, useEffect } from "react"
import { open } from "@tauri-apps/plugin-dialog"
import i18n from "@/i18n"
import { useWikiStore } from "@/stores/wiki-store"
import { useReviewStore } from "@/stores/review-store"
import { useLintStore } from "@/stores/lint-store"
import { useChatStore } from "@/stores/chat-store"
import { listDirectory, openProject } from "@/commands/fs"
import { Skeleton } from "@/components/ui/skeleton"
import { ToastContainer } from "@/components/ui/toast"
import { getLastProject, saveLastProject, loadLlmConfig, loadLanguage, loadSearchApiConfig, loadEmbeddingConfig, loadMultimodalConfig, loadOutputLanguage, loadProviderConfigs, loadActivePresetId, loadProxyConfig, loadScheduledImportConfig, saveScheduledImportConfig, loadSourceWatchConfig, loadApiConfig } from "@/lib/project-store"
import { loadReviewItems, loadLintItems, loadChatHistory } from "@/lib/persist"
import { setupAutoSave } from "@/lib/auto-save"

import { AppLayout } from "@/components/layout/app-layout"
import { WelcomeScreen } from "@/components/project/welcome-screen"
import { CreateProjectDialog } from "@/components/project/create-project-dialog"
import type { WikiProject } from "@/types/wiki"

function App() {
  const project = useWikiStore((s) => s.project)
  const setProject = useWikiStore((s) => s.setProject)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const [showCreateDialog, setShowCreateDialog] = useState(false)
  const [loading, setLoading] = useState(true)

  // Set up auto-save once on mount
  useEffect(() => {
    setupAutoSave()
  }, [])

  // Auto-open last project on startup
  useEffect(() => {
    async function init() {
      try {
        const savedConfig = await loadLlmConfig()
        if (savedConfig) {
          useWikiStore.getState().setLlmConfig(savedConfig)
        }
        const savedProviderConfigs = await loadProviderConfigs()
        if (savedProviderConfigs) {
          useWikiStore.getState().setProviderConfigs(savedProviderConfigs)
        }
        const savedActivePreset = await loadActivePresetId()
        if (savedActivePreset) {
          useWikiStore.getState().setActivePresetId(savedActivePreset)
          // Re-resolve the active preset's LlmConfig from (preset defaults
          // + saved overrides). Without this, preset default updates
          // (e.g. a corrected Anthropic model ID shipped in a release)
          // never reach users who are relying on defaults — their stored
          // `llmConfig` snapshot from a previous launch would keep the
          // old value. Overrides still win, so an explicit user choice
          // is preserved.
          const { LLM_PRESETS } = await import("@/components/settings/llm-presets")
          const { resolveConfig } = await import("@/components/settings/preset-resolver")
          const preset = LLM_PRESETS.find((p) => p.id === savedActivePreset)
          if (preset) {
            const currentFallback = useWikiStore.getState().llmConfig
            const override = (savedProviderConfigs ?? {})[savedActivePreset]
            const resolved = resolveConfig(preset, override, currentFallback)
            useWikiStore.getState().setLlmConfig(resolved)
            const { saveLlmConfig } = await import("@/lib/project-store")
            await saveLlmConfig(resolved)
          }
        }
        const savedSearchConfig = await loadSearchApiConfig()
        if (savedSearchConfig) {
          useWikiStore.getState().setSearchApiConfig(savedSearchConfig)
        }
        const savedEmbeddingConfig = await loadEmbeddingConfig()
        if (savedEmbeddingConfig) {
          useWikiStore.getState().setEmbeddingConfig(savedEmbeddingConfig)
        }
        const savedMultimodalConfig = await loadMultimodalConfig()
        if (savedMultimodalConfig) {
          useWikiStore.getState().setMultimodalConfig(savedMultimodalConfig)
        }
        const savedProxy = await loadProxyConfig()
        if (savedProxy) {
          useWikiStore.getState().setProxyConfig(savedProxy)
        }
        // Local HTTP API server config — global (single token + enable
        // flag for the whole install, not per-project). The Rust side
        // reads `apiConfig.{enabled,token}` from `app-state.json`
        // directly; this only hydrates the Zustand store so the
        // Settings UI reflects the persisted values.
        const savedApi = await loadApiConfig()
        if (savedApi) {
          useWikiStore.getState().setApiConfig({
            enabled: typeof savedApi.enabled === "boolean" ? savedApi.enabled : true,
            allowUnauthenticated:
              typeof savedApi.allowUnauthenticated === "boolean"
                ? savedApi.allowUnauthenticated
                : false,
            token: typeof savedApi.token === "string" ? savedApi.token : "",
          })
        }
        const savedLang = await loadLanguage()
        if (savedLang) {
          await i18n.changeLanguage(savedLang)
        }
        const lastProject = await getLastProject()
        if (lastProject) {
          try {
            const proj = await openProject(lastProject.path)
            await handleProjectOpened(proj)
          } catch {
            // Last project no longer valid
          }
        }
      } catch {
        // ignore init errors
      } finally {
        setLoading(false)
      }
    }
    init()
  }, [])

  async function handleProjectOpened(proj: WikiProject) {
    // Clear all per-project state BEFORE loading new project data
    // to prevent cross-project contamination. MUST be awaited so the
    // ingest queue / graph cache are actually cleared before the new
    // project's state is populated.
    const { resetProjectState } = await import("@/lib/reset-project-state")
    await resetProjectState()

    setProject(proj)
    const projectOutputLang = await loadOutputLanguage(proj.id)
    useWikiStore.getState().setOutputLanguage(projectOutputLang ?? "auto")
    setSelectedFile(null)
    setActiveView("wiki")
    // Bump data version so any cached graphs/views invalidate
    useWikiStore.getState().bumpDataVersion()
    await saveLastProject(proj)

    // Restore ingest queue (resume interrupted tasks). Keyed by the
    // project's stable UUID so the queue still finds the right project
    // even if the filesystem path changed since the task was enqueued.
    // Await this before starting file sync: watcher events for raw/sources
    // may enqueue ingest tasks and require an active project queue.
    try {
      const { restoreQueue } = await import("@/lib/ingest-queue")
      await restoreQueue(proj.id, proj.path)
    } catch (err) {
      console.error("Failed to restore ingest queue:", err)
    }
    // Same handshake for the dedup-merge queue.
    import("@/lib/dedup-queue").then(({ restoreQueue }) => {
      restoreQueue(proj.id, proj.path).catch((err) =>
        console.error("Failed to restore dedup queue:", err)
      )
    })
    // Load per-project scheduled import config
    try {
      const savedScheduledImport = await loadScheduledImportConfig(proj.path)
      if (savedScheduledImport) {
        // Migrate relative path to absolute (backward compatibility)
        let path = savedScheduledImport.path
        if (path && !path.startsWith("/") && !path.match(/^[a-zA-Z]:[/\\]/)) {
          path = `${proj.path}/${path}`
        }
        useWikiStore.getState().setScheduledImportConfig({
          ...savedScheduledImport,
          path,
        })
      } else {
        // Reset to default for new projects
        useWikiStore.getState().setScheduledImportConfig({
          enabled: false,
          path: `${proj.path}/raw/sources`,
          interval: 60,
          lastScan: null,
        })
      }
    } catch {
      // ignore
    }
    // Start scheduled import if enabled
    const scheduledImportConfig = useWikiStore.getState().scheduledImportConfig
    if (scheduledImportConfig.enabled && scheduledImportConfig.path && scheduledImportConfig.interval > 0) {
      import("@/lib/scheduled-import").then(({ startScheduledImport }) => {
        startScheduledImport(proj, scheduledImportConfig)
      }).catch((err) =>
        console.error("Failed to start scheduled import:", err)
      )
    }

    // Start project source watch if enabled
    import("@/lib/project-file-sync").then(async ({ startProjectFileSync, stopProjectFileSync }) => {
      const config = await loadSourceWatchConfig(proj.id)
      useWikiStore.getState().setSourceWatchConfig(config)
      if (config.enabled) {
        startProjectFileSync(proj, config).catch((err) =>
          console.error("Failed to start project file sync:", err)
        )
      } else {
        stopProjectFileSync().catch(() => {})
      }
    }).catch((err) => console.error("Failed to configure project file sync:", err))
    
    try {
      const tree = await listDirectory(proj.path)
      setFileTree(tree)
    } catch (err) {
      console.error("Failed to load file tree:", err)
    }
    // Load persisted review items
    try {
      const savedReview = await loadReviewItems(proj.path)
      if (savedReview.length > 0) {
        useReviewStore.getState().setItems(savedReview)
      }
    } catch {
      // ignore, start fresh
    }
    // Load persisted lint items
    useLintStore.getState().setItems([])
    try {
      const savedLint = await loadLintItems(proj.path)
      useLintStore.getState().setItems(savedLint)
    } catch {
      useLintStore.getState().setItems([])
    }
    // Load persisted chat history
    try {
      const savedChat = await loadChatHistory(proj.path)
      if (savedChat.conversations.length > 0) {
        useChatStore.getState().setConversations(savedChat.conversations)
        useChatStore.getState().setMessages(savedChat.messages)
        // Set most recent conversation as active
        const sorted = [...savedChat.conversations].sort((a, b) => b.updatedAt - a.updatedAt)
        if (sorted[0]) {
          useChatStore.getState().setActiveConversation(sorted[0].id)
        }
      }
    } catch {
      // ignore, start fresh
    }
  }

  async function handleSelectRecent(proj: WikiProject) {
    try {
      const validated = await openProject(proj.path)
      await handleProjectOpened(validated)
    } catch (err) {
      window.alert(`Failed to open project: ${err}`)
    }
  }

  async function handleOpenProject() {
    const selected = await open({
      directory: true,
      multiple: false,
      title: "Open Wiki Project",
    })
    if (!selected) return
    try {
      const proj = await openProject(selected)
      await handleProjectOpened(proj)
    } catch (err) {
      window.alert(`Failed to open project: ${err}`)
    }
  }

  async function handleSwitchProject() {
    // Stop scheduled import before switching projects
    import("@/lib/scheduled-import").then(({ stopScheduledImport }) => {
      stopScheduledImport()
    }).catch(() => {})

    // Save current project's scheduled import config before clearing
    const currentProject = useWikiStore.getState().project
    if (currentProject) {
      const currentConfig = useWikiStore.getState().scheduledImportConfig
      saveScheduledImportConfig(currentProject.path, currentConfig).catch(() => {})
    }

    // Clear all per-project state BEFORE flipping back to the welcome screen
    // so old data cannot leak in via any async render pass.
    const { resetProjectState } = await import("@/lib/reset-project-state")
    await resetProjectState()
    setProject(null)
    setFileTree([])
    setSelectedFile(null)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="space-y-4 w-full max-w-md p-6">
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-32 w-full mt-6" />
        </div>
      </div>
    )
  }

  if (!project) {
    return (
      <>
        <WelcomeScreen
          onCreateProject={() => setShowCreateDialog(true)}
          onOpenProject={handleOpenProject}
          onSelectProject={handleSelectRecent}
        />
        <CreateProjectDialog
          open={showCreateDialog}
          onOpenChange={setShowCreateDialog}
          onCreated={handleProjectOpened}
        />
      </>
    )
  }

  return (
    <>
      <AppLayout onSwitchProject={handleSwitchProject} />
      <CreateProjectDialog
        open={showCreateDialog}
        onOpenChange={setShowCreateDialog}
        onCreated={handleProjectOpened}
      />
      <ToastContainer />
    </>
  )
}

export default App
