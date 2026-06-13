import { useCallback, useEffect, useState } from "react"
import { ChevronDown, FolderOpen } from "lucide-react"
import { open } from "@tauri-apps/plugin-dialog"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { ModuleTabs } from "@/components/console/module-tabs"
import { KnowledgeTree } from "@/components/layout/knowledge-tree"
import { PreviewPanel } from "@/components/layout/preview-panel"
import { ActivityPanel } from "@/components/layout/activity-panel"
import { WikiWorkspace } from "@/components/wiki/wiki-workspace"
import { SourcesView } from "@/components/sources/sources-view"
import { LintView } from "@/components/lint/lint-view"
import { ReviewView } from "@/components/review/review-view"
import { SearchView } from "@/components/search/search-view"
import { ErrorBoundary } from "@/components/error-boundary"
import { openProject } from "@/commands/fs"
import { getRecentProjects } from "@/lib/project-store"
import { openWikiProject } from "@/lib/open-wiki-project"
import {
  LAYOUT_KEYS,
  WIKI_TABS,
  type WikiTab,
} from "@/lib/console-layout"
import { useModuleTab } from "@/hooks/use-module-tab"
import { useWikiStore } from "@/stores/wiki-store"
import { useReviewStore } from "@/stores/review-store"
import { useConsoleStore } from "@/stores/console-store"
import type { WikiProject } from "@/types/wiki"

/** 系统 · 知识库 — 专家工具平铺（无 AppLayout 套娃，局部 expertTab） */
export function SystemKnowledgePanel() {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const navigateBrain = useConsoleStore((s) => s.navigateBrain)

  const [expertTab, setExpertTab] = useModuleTab<WikiTab>({
    storageKey: LAYOUT_KEYS.systemKnowledgeTab,
    allowed: WIKI_TABS,
    defaultTab: "wiki",
  })

  const pendingCount = useReviewStore(
    (s) => s.items.filter((i) => !i.resolved).length,
  )

  const [recent, setRecent] = useState<WikiProject[]>([])
  const [opening, setOpening] = useState(false)

  const loadRecent = useCallback(() => {
    void getRecentProjects().then(setRecent)
  }, [])

  useEffect(() => {
    if (!project) loadRecent()
  }, [project, loadRecent])

  const bindProject = useCallback(async (proj: WikiProject) => {
    await openWikiProject(proj, { source: "system" })
  }, [])

  async function handleOpenFolder() {
    setOpening(true)
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t("welcome.openProject"),
      })
      if (!selected) return
      await bindProject(await openProject(selected))
    } catch (err) {
      window.alert(String(err))
    } finally {
      setOpening(false)
    }
  }

  function handleExpertTabChange(tab: WikiTab) {
    setExpertTab(tab)
    if (tab !== "wiki") {
      setSelectedFile(null)
    }
  }

  const tabs = WIKI_TABS.map((id) => ({
    id,
    label:
      id === "review" && pendingCount > 0
        ? `${t("nav.review")} (${pendingCount > 99 ? "99+" : pendingCount})`
        : t(`nav.${id}`),
  }))

  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
        <p className="max-w-md text-sm text-muted-foreground">
          {t("console.system.advanced.wikiNeedProject")}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            size="sm"
            disabled={opening}
            onClick={() => void handleOpenFolder()}
          >
            <FolderOpen className="mr-2 h-4 w-4" />
            {t("console.brain.kbOpenFolder")}
          </Button>
          <Button size="sm" variant="outline" onClick={() => navigateBrain("kb")}>
            {t("console.system.advanced.openBrainKb")}
          </Button>
        </div>
        {recent.length > 0 && (
          <ul className="mt-2 w-full max-w-sm space-y-1 text-left text-sm">
            {recent.slice(0, 5).map((p) => (
              <li key={p.path}>
                <button
                  type="button"
                  className="w-full truncate rounded-md px-2 py-1.5 text-left hover:bg-muted"
                  onClick={() =>
                    void bindProject(p).catch((err) => window.alert(String(err)))
                  }
                >
                  {p.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    )
  }

  const showTree = expertTab === "wiki"
  const showPreview = showTree && !!selectedFile

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b px-4 py-2">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void handleOpenFolder()}
            className="flex max-w-[min(240px,40vw)] items-center gap-1 rounded-md px-2 py-1 text-sm font-medium hover:bg-accent"
            title={t("nav.switchProject")}
          >
            <span className="truncate">{project.name}</span>
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
          <span className="hidden truncate text-xs text-muted-foreground sm:inline">
            {project.path}
          </span>
        </div>
        <ModuleTabs
          tabs={tabs}
          active={expertTab}
          onChange={handleExpertTabChange}
          ariaLabel={t("nav.wiki")}
          className="border-0 px-0"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <WikiWorkspace
          tree={showTree ? <KnowledgeTree /> : undefined}
          treeFooter={showTree ? <ActivityPanel /> : undefined}
          main={
            <div className="flex h-full min-h-0 flex-col overflow-hidden">
              <ErrorBoundary>
                {expertTab === "wiki" && !selectedFile && (
                  <div className="flex h-full items-center justify-center p-8 text-center text-sm text-muted-foreground">
                    {t("console.brain.kbSelectPage")}
                  </div>
                )}
                {expertTab === "wiki" && selectedFile && (
                  <div className="flex h-full items-center justify-center p-8 text-center text-xs text-muted-foreground">
                    {selectedFile}
                  </div>
                )}
                {expertTab === "sources" && <SourcesView />}
                {expertTab === "lint" && <LintView />}
                {expertTab === "review" && <ReviewView />}
                {expertTab === "search" && <SearchView />}
              </ErrorBoundary>
            </div>
          }
          inspector={
            showPreview ? (
              <ErrorBoundary>
                <PreviewPanel />
              </ErrorBoundary>
            ) : undefined
          }
        />
      </div>
    </div>
  )
}
