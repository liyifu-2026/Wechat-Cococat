import { useEffect, useState } from "react"
import i18n from "@/i18n"
import { useWikiStore } from "@/stores/wiki-store"
import { openProject } from "@/commands/fs"
import { openWikiProject } from "@/lib/open-wiki-project"
import { Skeleton } from "@/components/ui/skeleton"
import {
  getLastProject,
  loadLlmConfig,
  loadLanguage,
  loadSearchApiConfig,
  loadEmbeddingConfig,
  loadMultimodalConfig,
  loadProviderConfigs,
  loadActivePresetId,
  loadProxyConfig,
  loadApiConfig,
} from "@/lib/project-store"
import { setupAutoSave } from "@/lib/auto-save"
import { ConsoleShell } from "@/components/console/console-shell"
import { OverviewModule } from "@/components/console/overview-module"
import { InboxModule } from "@/components/console/inbox-module"
import { BrainModule } from "@/components/console/brain-module"
import { SystemModule } from "@/components/console/system-module"
import { useConsoleStore } from "@/stores/console-store"

function App() {
  const activeModule = useConsoleStore((s) => s.activeModule)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setupAutoSave()
  }, [])

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
            await openWikiProject(proj, { source: "welcome" })
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
    void init()
  }, [])

  function renderModule() {
    switch (activeModule) {
      case "overview":
        return <OverviewModule />
      case "inbox":
        return <InboxModule />
      case "brain":
        return <BrainModule />
      case "system":
        return <SystemModule />
      default:
        return <OverviewModule />
    }
  }

  return (
    <ConsoleShell>
      {loading ? (
        <div className="flex h-full items-center justify-center">
          <div className="w-full max-w-md space-y-4 p-6">
            <Skeleton className="h-8 w-3/4" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="mt-6 h-32 w-full" />
          </div>
        </div>
      ) : (
        renderModule()
      )}
    </ConsoleShell>
  )
}

export default App
