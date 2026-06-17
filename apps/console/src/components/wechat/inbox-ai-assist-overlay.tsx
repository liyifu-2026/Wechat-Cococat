import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ChevronLeft, Sparkles, Trash2, X, ChevronRight } from "lucide-react"
import { useTranslation } from "react-i18next"
import { readFile } from "@/commands/fs"
import { FilePreview } from "@/components/editor/file-preview"
import { Button } from "@/components/ui/button"
import { WikiSearchWorkspace } from "@/components/wiki/wiki-search-workspace"
import { InboxAiAssistChat } from "@/components/wechat/inbox-ai-assist-chat"
import { InboxAiComposer } from "@/components/wechat/inbox-ai-composer"
import { InboxAiLiquidGlass } from "@/components/wechat/inbox-ai-liquid-glass"
import { useAllWikiProjects } from "@/hooks/use-all-wiki-projects"
import { useInboxAiAssistSend } from "@/hooks/use-inbox-ai-assist-send"
import {
  INBOX_AI_ASSIST_HOST_ID,
  INBOX_AI_EXPAND_HOST_ID,
  INBOX_AI_PANEL_ID,
} from "@/lib/inbox-ai-hosts"
import { getFileName } from "@/lib/path-utils"
import {
  resolveWikiAbsolutePath,
  type WikiReferenceOpenMeta,
} from "@/lib/wiki-reference-path"
import { resolveWikiPagePath } from "@/lib/wiki-link-resolve"
import {
  hasAiAssistExpand,
  isAiAssistPanelOpen,
  selectAiAssistExpand,
  useAiAssistStore,
  type AiAssistExpand,
  type AiAssistMode,
} from "@/stores/ai-assist-store"
import { useToastStore } from "@/stores/toast-store"

function AssistHostPortal({ children }: { children: React.ReactNode }) {
  const host =
    typeof document !== "undefined"
      ? document.getElementById(INBOX_AI_ASSIST_HOST_ID)
      : null
  if (!host) return null
  return createPortal(children, host)
}

function ExpandHostPortal({ children }: { children: React.ReactNode }) {
  const host =
    typeof document !== "undefined"
      ? document.getElementById(INBOX_AI_EXPAND_HOST_ID)
      : null
  if (!host) return null
  return createPortal(children, host)
}

function PanelHeader({
  title,
  mode,
  onClose,
  onClear,
}: {
  title: string
  mode: AiAssistMode
  onClose: () => void
  onClear?: () => void
}) {
  const { t } = useTranslation()

  return (
    <header className="flex shrink-0 items-center gap-2 border-b border-[var(--wx-border)]/40 px-3 py-2.5">
      <Sparkles className="h-4 w-4 shrink-0 text-emerald-400" />
      <h2 className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--wx-text)]">
        {title}
      </h2>
      {mode === "assist" && onClear && (
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="h-8 w-8 text-[var(--wx-muted)]"
          aria-label={t("wechat.aiAssist.clearSession")}
          onClick={onClear}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      )}
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        className="h-8 w-8 text-[var(--wx-muted)]"
        aria-label={t("wechat.aiAssist.close")}
        onClick={onClose}
      >
        <X className="h-4 w-4" />
      </Button>
    </header>
  )
}

function WikiExpandPanel({
  expand,
  canGoForward,
  onBack,
  onForward,
  onWikiLinkClick,
}: {
  expand: AiAssistExpand
  canGoForward: boolean
  onBack: () => void
  onForward: () => void
  onWikiLinkClick: (pageName: string) => void
}) {
  const { t } = useTranslation()
  const [content, setContent] = useState<string | null>(null)
  const [resolvedPath, setResolvedPath] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      const absolute = resolveWikiAbsolutePath({
        path: expand.path,
        projectPath: expand.projectPath,
        relPath: expand.relPath,
      })
      try {
        const text = await readFile(absolute)
        if (cancelled) return
        setResolvedPath(absolute)
        setContent(text)
      } catch {
        if (!cancelled) {
          setContent(null)
          setResolvedPath(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [expand.path, expand.projectPath, expand.relPath])

  const title =
    expand.title ??
    (resolvedPath ? getFileName(resolvedPath) : getFileName(expand.path))

  return (
    <ExpandHostPortal>
      <div
        className="inbox-ai-expand-scrim"
        onClick={onBack}
        role="presentation"
      />
      <div className="inbox-ai-expand-panel pointer-events-none">
        <div className="pointer-events-auto h-full">
          <InboxAiLiquidGlass className="h-full">
            <header className="flex shrink-0 items-center gap-1 border-b border-[var(--wx-border)]/40 px-2 py-2.5">
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="h-8 w-8 text-[var(--wx-muted)]"
                aria-label={t("wechat.aiAssist.backToPanel")}
                onClick={onBack}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                type="button"
                size="icon-sm"
                variant="ghost"
                className="h-8 w-8 text-[var(--wx-muted)] disabled:opacity-30"
                aria-label={t("wechat.aiAssist.expandForward")}
                disabled={!canGoForward}
                onClick={onForward}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <h3 className="min-w-0 flex-1 truncate px-1 text-sm font-medium text-[var(--wx-text)]">
                {title}
              </h3>
            </header>
            <div className="min-h-0 flex-1 overflow-y-auto p-4">
              {loading ? (
                <p className="text-sm text-[var(--wx-muted)]">
                  {t("wechat.aiAssist.loadingExpand")}
                </p>
              ) : content && resolvedPath ? (
                <FilePreview
                  filePath={resolvedPath}
                  textContent={content}
                  projectPathOverride={expand.projectPath}
                  onWikiLinkClick={onWikiLinkClick}
                />
              ) : (
                <p className="text-sm text-[var(--wx-muted)]">
                  {t("wechat.aiAssist.expandLoadFailed")}
                </p>
              )}
            </div>
          </InboxAiLiquidGlass>
        </div>
      </div>
    </ExpandHostPortal>
  )
}

export function InboxAiAssistOverlay() {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const chatId = useAiAssistStore((s) => s.boundInboxChatId)
  const wiki = useAllWikiProjects()
  const layer = useAiAssistStore((s) => s.layer)
  const mode = useAiAssistStore((s) => s.mode)
  const assistDraft = useAiAssistStore((s) => s.assistDraft)
  const searchQuery = useAiAssistStore((s) => s.searchQuery)
  const submittedSearch = useAiAssistStore((s) => s.submittedSearch)
  const expandStack = useAiAssistStore((s) => s.expandStack)
  const expandIndex = useAiAssistStore((s) => s.expandIndex)
  const expand = selectAiAssistExpand({ expandStack, expandIndex })
  const setMode = useAiAssistStore((s) => s.setMode)
  const setAssistDraft = useAiAssistStore((s) => s.setAssistDraft)
  const setSearchQuery = useAiAssistStore((s) => s.setSearchQuery)
  const setSubmittedSearch = useAiAssistStore((s) => s.setSubmittedSearch)
  const close = useAiAssistStore((s) => s.close)
  const closeExpand = useAiAssistStore((s) => s.closeExpand)
  const expandBack = useAiAssistStore((s) => s.expandBack)
  const expandForward = useAiAssistStore((s) => s.expandForward)
  const openExpand = useAiAssistStore((s) => s.openExpand)
  const resetSession = useAiAssistStore((s) => s.resetSession)

  const partialToastShownRef = useRef(false)

  const { handleSend, handleStop, isStreaming, hasWiki } =
    useInboxAiAssistSend()

  const wikiBlocked =
    !wiki.loading &&
    (wiki.status === "unbound" ||
      wiki.status === "broken" ||
      wiki.resolved.length === 0)
  const wikiReady = hasWiki && !wikiBlocked

  const federatedProjects = wiki.resolved.map((p) => ({
    projectPath: p.projectPath,
    projectName: p.name || p.alias,
  }))
  const wikiProjectPaths = wiki.resolved.map((p) => p.projectPath)

  useEffect(() => {
    if (!isAiAssistPanelOpen(layer)) return
    return () => {
      useAiAssistStore.getState().disposePanel()
    }
  }, [layer])

  useEffect(() => {
    if (!isAiAssistPanelOpen(layer)) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") close()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [layer, close])

  useEffect(() => {
    if (wiki.status !== "partial" || wiki.invalidAliases.length === 0) return
    if (partialToastShownRef.current) return
    partialToastShownRef.current = true
    addToast(
      t("wechat.aiAssist.wikiPartialInvalid", {
        aliases: wiki.invalidAliases.join(", "),
      }),
      "info",
    )
  }, [addToast, t, wiki.invalidAliases, wiki.status])

  useEffect(() => {
    if (!chatId) close()
  }, [chatId, close])

  if (!chatId) return null

  if (
    !isAiAssistPanelOpen(layer) &&
    !hasAiAssistExpand({ expandStack, expandIndex })
  ) {
    return null
  }

  const panelTitle =
    mode === "search"
      ? t("wechat.aiAssist.modeSearch")
      : t("wechat.aiAssist.modeAssist")

  const handleExpandWikiLink = async (pageName: string) => {
    const candidates = [
      expand?.projectPath,
      ...wiki.resolved.map((p) => p.projectPath),
    ].filter((p): p is string => Boolean(p?.trim()))
    const seen = new Set<string>()
    for (const projectPath of candidates) {
      if (seen.has(projectPath)) continue
      seen.add(projectPath)
      const absolute = await resolveWikiPagePath(pageName, projectPath)
      if (!absolute) continue
      openExpand({
        kind: "wiki",
        path: absolute,
        title: pageName,
        projectPath,
      })
      return
    }
  }

  const handleExpandBack = () => {
    if (expandIndex <= 0) closeExpand()
    else expandBack()
  }

  const canGoForward = expandIndex >= 0 && expandIndex < expandStack.length - 1

  const openWikiExpand = (
    path: string,
    title?: string,
    meta?: WikiReferenceOpenMeta,
  ) => {
    const absolute = resolveWikiAbsolutePath({
      path,
      projectPath: meta?.projectPath,
      relPath: meta?.relPath,
    })
    openExpand({
      kind: "wiki",
      path: absolute,
      title,
      projectPath: meta?.projectPath,
      relPath: meta?.relPath,
      projectName: meta?.projectName,
    })
  }

  function renderPanelBody() {
    if (wiki.loading) {
      return (
        <div className="inbox-ai-content-fade flex flex-1 items-center justify-center p-6 text-sm text-[var(--wx-muted)]">
          {t("wechat.aiAssist.wikiLoading")}
        </div>
      )
    }

    if (wikiBlocked) {
      return (
        <div className="inbox-ai-content-fade flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 py-6 text-center">
          <h3 className="text-sm font-medium text-[var(--wx-text)]">
            {t("wechat.aiAssist.noWikiRegisteredTitle")}
          </h3>
          <p className="max-w-xs text-sm text-[var(--wx-muted)]">
            {t("wechat.aiAssist.noWikiRegisteredHint")}
          </p>
        </div>
      )
    }

    if (mode === "assist") {
      return (
        <InboxAiAssistChat
          wikiProjectPaths={wikiProjectPaths}
          onOpenReference={(path, title, meta) =>
            openWikiExpand(path, title, meta)
          }
        />
      )
    }

    return (
      <WikiSearchWorkspace
        key={submittedSearch}
        variant="inbox"
        embedded
        submittedQuery={submittedSearch}
        federatedProjects={federatedProjects}
        className="inbox-ai-content-fade min-h-0 flex-1"
        onOpenPage={openWikiExpand}
      />
    )
  }

  return (
    <>
      {isAiAssistPanelOpen(layer) && (
        <AssistHostPortal>
          <div
            className="inbox-ai-scrim-list"
            onClick={() => close()}
            role="presentation"
          />
          <div className="inbox-ai-panel-shell">
            <InboxAiLiquidGlass id={INBOX_AI_PANEL_ID}>
              <PanelHeader
                title={panelTitle}
                mode={mode}
                onClose={close}
                onClear={resetSession}
              />
              <div className="flex min-h-0 flex-1 flex-col">{renderPanelBody()}</div>
              <InboxAiComposer
                mode={mode}
                assistDraft={assistDraft}
                searchQuery={searchQuery}
                isStreaming={isStreaming}
                wikiReady={wikiReady}
                onModeChange={setMode}
                onAssistDraftChange={setAssistDraft}
                onSearchQueryChange={setSearchQuery}
                onAssistSubmit={(text) =>
                  void handleSend(text, {
                    useWebSearch: false,
                    useAnyTxtSearch: false,
                  })
                }
                onSearchSubmit={(q) => {
                  setSearchQuery(q)
                  setSubmittedSearch(q)
                }}
                onAssistStop={handleStop}
              />
            </InboxAiLiquidGlass>
          </div>
        </AssistHostPortal>
      )}
      {expand && (
        <WikiExpandPanel
          expand={expand}
          canGoForward={canGoForward}
          onBack={handleExpandBack}
          onForward={expandForward}
          onWikiLinkClick={(pageName) => void handleExpandWikiLink(pageName)}
        />
      )}
    </>
  )
}
