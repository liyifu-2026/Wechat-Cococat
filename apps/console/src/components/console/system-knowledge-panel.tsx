import { useCallback, useEffect, useState } from "react"
import { ChevronDown, FolderOpen } from "lucide-react"
import { open } from "@tauri-apps/plugin-dialog"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { BrainKbEditor } from "@/components/console/brain-kb-editor"
import { ModuleTabs } from "@/components/console/module-tabs"
import { KnowledgeTree } from "@/components/layout/knowledge-tree"
import { ActivityPanel } from "@/components/layout/activity-panel"
import { WechatWindowControls } from "@/components/wechat/wechat-window-controls"
import { isTauri } from "@/lib/tauri-window"
import { WikiWorkspace } from "@/components/wiki/wiki-workspace"
import { SourcesView } from "@/components/sources/sources-view"
import { LintView } from "@/components/lint/lint-view"
import { ReviewView } from "@/components/review/review-view"
import { SearchView } from "@/components/search/search-view"
import { ErrorBoundary } from "@/components/error-boundary"
import { openProject } from "@/commands/fs"
import { getRecentProjects } from "@/lib/project-store"
import { openWikiProject } from "@/lib/open-wiki-project"
import { resolveWikiDeepLink } from "@/lib/wiki-page-resolve"
import {
  LAYOUT_KEYS,
  WIKI_TABS,
  type WikiTab,
} from "@/lib/console-layout"
import { useModuleTab } from "@/hooks/use-module-tab"
import { useWikiStore } from "@/stores/wiki-store"
import { useReviewStore } from "@/stores/review-store"
import { useLintStore } from "@/stores/lint-store"
import { useConsoleStore } from "@/stores/console-store"
import type { WikiProject } from "@/types/wiki"
import { cn } from "@/lib/utils"

type SystemKnowledgePanelProps = {
  variant?: "default" | "wechat"
}

/** 系统 · 知识库 — 专家工具平铺（无 AppLayout 套娃，局部 expertTab） */
export function SystemKnowledgePanel({
  variant = "default",
}: SystemKnowledgePanelProps) {
  const wechat = variant === "wechat"
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const fileTree = useWikiStore((s) => s.fileTree)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const consumePendingKb = useConsoleStore((s) => s.consumePendingKb)
  const hasPendingKbDeepLink = useConsoleStore((s) => s.hasPendingKbDeepLink)

  const [editModeForPath, setEditModeForPath] = useState<string | null>(null)

  const [expertTab, setExpertTab] = useModuleTab<WikiTab>({
    storageKey: LAYOUT_KEYS.systemKnowledgeTab,
    allowed: WIKI_TABS,
    defaultTab: "wiki",
  })

  const pendingCount = useReviewStore(
    (s) => s.items.filter((i) => !i.resolved).length,
  )
  const lintCount = useLintStore((s) => s.items.length)

  const [recent, setRecent] = useState<WikiProject[]>([])
  const [opening, setOpening] = useState(false)

  const loadRecent = useCallback(() => {
    void getRecentProjects().then(setRecent)
  }, [])

  useEffect(() => {
    setActiveView("wiki")
  }, [setActiveView])

  useEffect(() => {
    if (!project || fileTree.length === 0) return
    if (!hasPendingKbDeepLink()) return

    const { wikiPath, topic, openInEditMode } = consumePendingKb()
    if (!wikiPath && !topic) return

    const targetPath = resolveWikiDeepLink(fileTree, { wikiPath, topic })
    if (targetPath) {
      setSelectedFile(targetPath)
      setEditModeForPath(openInEditMode ? targetPath : null)
    } else if (topic) {
      console.warn(`[DeepLink] Unable to resolve wiki path for topic: ${topic}`)
    }
  }, [
    project,
    fileTree,
    dataVersion,
    consumePendingKb,
    hasPendingKbDeepLink,
    setSelectedFile,
  ])

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

  const tabs = WIKI_TABS.map((id) => {
    const badge =
      id === "review" && pendingCount > 0
        ? pendingCount > 99
          ? "99+"
          : String(pendingCount)
        : id === "lint" && lintCount > 0
          ? lintCount > 99
            ? "99+"
            : String(lintCount)
          : null
    return {
      id,
      label: badge ? `${t(`nav.${id}`)} (${badge})` : t(`nav.${id}`),
    }
  })

  if (!project) {
    const emptyBody = (
      <>
        <p
          className={cn(
            "max-w-md text-sm",
            wechat ? "text-[var(--wx-muted)]" : "text-muted-foreground",
          )}
        >
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
      </>
    )

    if (wechat) {
      return (
        <div className="flex h-full min-h-0 flex-col bg-[var(--wechat-dark-panel)] text-[var(--wx-text)]">
          <div
            className="flex shrink-0 items-center gap-2 border-b border-[var(--wx-border)] px-4 py-2"
            data-tauri-drag-region={isTauri() ? true : undefined}
          >
            <ModuleTabs
              tabs={tabs}
              active={expertTab}
              onChange={handleExpertTabChange}
              ariaLabel={t("nav.wiki")}
              className="min-w-0 flex-1 border-0 px-0"
            />
            <WechatWindowControls layout="horizontal" className="shrink-0" />
          </div>
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
            {emptyBody}
          </div>
        </div>
      )
    }

    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
        {emptyBody}
      </div>
    )
  }

  const showTree = expertTab === "wiki"

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col",
        wechat
          ? "bg-[var(--wechat-dark-panel)] text-[var(--wx-text)]"
          : "bg-background text-foreground",
      )}
    >
      <div
        className={cn(
          "flex shrink-0 items-center gap-2 border-b px-4 py-2",
          wechat && "border-[var(--wx-border)]",
        )}
        data-tauri-drag-region={wechat && isTauri() ? true : undefined}
      >
        <div
          className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden"
          data-tauri-drag-region={wechat && isTauri() ? true : undefined}
        >
          <button
            type="button"
            onClick={() => void handleOpenFolder()}
            className={cn(
              "flex max-w-[min(200px,32vw)] shrink-0 items-center gap-1 rounded-md px-2 py-1 text-sm font-medium",
              wechat
                ? "hover:bg-[var(--wx-list-hover)]"
                : "hover:bg-accent",
            )}
            title={t("nav.switchProject")}
          >
            <span className="truncate">{project.name}</span>
            <ChevronDown
              className={cn(
                "h-4 w-4 shrink-0",
                wechat ? "text-[var(--wx-muted)]" : "text-muted-foreground",
              )}
            />
          </button>
          {!wechat && (
            <span className="hidden truncate text-xs sm:inline text-muted-foreground">
              {project.path}
            </span>
          )}
          {wechat ? (
            <ModuleTabs
              tabs={tabs}
              active={expertTab}
              onChange={handleExpertTabChange}
              ariaLabel={t("nav.wiki")}
              className="min-w-0 flex-1 border-0 px-0"
            />
          ) : null}
        </div>
        {!wechat ? (
          <ModuleTabs
            tabs={tabs}
            active={expertTab}
            onChange={handleExpertTabChange}
            ariaLabel={t("nav.wiki")}
            className="shrink-0 border-0 px-0"
          />
        ) : (
          <WechatWindowControls layout="horizontal" className="shrink-0" />
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        <WikiWorkspace
          className={wechat ? "bg-[var(--wechat-dark-panel)]" : undefined}
          tree={showTree ? <KnowledgeTree /> : undefined}
          treeFooter={showTree ? <ActivityPanel /> : undefined}
          main={
            <div className="flex h-full min-h-0 flex-col overflow-hidden">
              <ErrorBoundary>
                {expertTab === "wiki" && (
                  <BrainKbEditor
                    initialEditMode={
                      !!selectedFile && editModeForPath === selectedFile
                    }
                  />
                )}
                {expertTab === "sources" && <SourcesView />}
                {expertTab === "lint" && <LintView />}
                {expertTab === "review" && <ReviewView />}
                {expertTab === "search" && <SearchView />}
              </ErrorBoundary>
            </div>
          }
          inspector={undefined}
        />
      </div>
    </div>
  )
}
