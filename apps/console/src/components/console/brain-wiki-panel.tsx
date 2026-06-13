import { useCallback, useEffect, useState } from "react"
import { FolderOpen, ExternalLink } from "lucide-react"
import { open } from "@tauri-apps/plugin-dialog"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { BrainKbEditor } from "@/components/console/brain-kb-editor"
import { BrainWikiRoutingHints } from "@/components/console/brain-wiki-routing-hints"
import { KnowledgeTree } from "@/components/layout/knowledge-tree"
import { WikiWorkspace } from "@/components/wiki/wiki-workspace"
import { openProject } from "@/commands/fs"
import { getRecentProjects } from "@/lib/project-store"
import { openWikiProject } from "@/lib/open-wiki-project"
import { resolveWikiDeepLink } from "@/lib/wiki-page-resolve"
import { useWikiStore } from "@/stores/wiki-store"
import { useConsoleStore } from "@/stores/console-store"
import type { WikiProject } from "@/types/wiki"

export function BrainWikiPanel() {
  const { t } = useTranslation()
  const project = useWikiStore((s) => s.project)
  const fileTree = useWikiStore((s) => s.fileTree)
  const dataVersion = useWikiStore((s) => s.dataVersion)
  const setActiveView = useWikiStore((s) => s.setActiveView)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const navigateSystemKnowledge = useConsoleStore((s) => s.navigateSystemKnowledge)
  const consumePendingKb = useConsoleStore((s) => s.consumePendingKb)
  const hasPendingKbDeepLink = useConsoleStore((s) => s.hasPendingKbDeepLink)
  const [recent, setRecent] = useState<WikiProject[]>([])
  const [opening, setOpening] = useState(false)
  /** One-shot edit mode for deep-linked file path */
  const [editModeForPath, setEditModeForPath] = useState<string | null>(null)

  const bindProject = useCallback(async (proj: WikiProject) => {
    await openWikiProject(proj, { source: "brain" })
  }, [])

  useEffect(() => {
    setActiveView("wiki")
  }, [setActiveView])

  useEffect(() => {
    void getRecentProjects().then(setRecent)
  }, [])

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
  }, [project, fileTree, dataVersion, consumePendingKb, hasPendingKbDeepLink, setSelectedFile])

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

  if (!project) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="max-w-md text-sm text-muted-foreground">
          {t("console.brain.kbNeedProject")}
        </p>
        <div className="flex flex-wrap justify-center gap-2">
          <Button size="sm" disabled={opening} onClick={() => void handleOpenFolder()}>
            <FolderOpen className="mr-2 h-4 w-4" />
            {t("console.brain.kbOpenFolder")}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => navigateSystemKnowledge()}
          >
            {t("console.brain.kbExpertMode")}
          </Button>
        </div>
        {recent.length > 0 && (
          <ul className="mt-2 w-full max-w-sm space-y-1 text-left text-sm">
            {recent.slice(0, 5).map((p) => (
              <li key={p.path}>
                <button
                  type="button"
                  className="w-full truncate rounded-md px-2 py-1.5 text-left hover:bg-muted"
                  onClick={() => void bindProject(p).catch((err) => window.alert(String(err)))}
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

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{project.name}</p>
          <p className="truncate text-xs text-muted-foreground">{project.path}</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" onClick={() => void handleOpenFolder()}>
            {t("console.brain.kbSwitchProject")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="text-xs"
            onClick={() => navigateSystemKnowledge()}
          >
            <ExternalLink className="mr-1 h-3 w-3" />
            {t("console.brain.kbExpertMode")}
          </Button>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <WikiWorkspace
          tree={<KnowledgeTree />}
          main={
            <div className="flex h-full min-h-0 flex-col overflow-hidden">
              <BrainWikiRoutingHints />
              <div className="min-h-0 flex-1 overflow-hidden">
                <BrainKbEditor
                  initialEditMode={
                    !!selectedFile && editModeForPath === selectedFile
                  }
                />
              </div>
            </div>
          }
        />
      </div>
    </div>
  )
}
