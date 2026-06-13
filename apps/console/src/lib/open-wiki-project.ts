import { listDirectory } from "@/commands/fs"
import { loadReviewItems, loadLintItems, loadChatHistory } from "@/lib/persist"
import {
  loadOutputLanguage,
  loadScheduledImportConfig,
  loadSourceWatchConfig,
  saveLastProject,
} from "@/lib/project-store"
import { useChatStore } from "@/stores/chat-store"
import { useLintStore } from "@/stores/lint-store"
import { useReviewStore } from "@/stores/review-store"
import { useWikiStore } from "@/stores/wiki-store"
import type { WikiProject } from "@/types/wiki"

export type OpenWikiProjectSource =
  | "welcome"
  | "brain"
  | "system"
  | "command-palette"
  | "create-dialog"

export interface OpenWikiProjectOptions {
  source?: OpenWikiProjectSource
}

export interface OpenWikiProjectResult {
  fileTreeLoaded: boolean
}

/**
 * SSOT for opening a Wiki project — same pipeline for Welcome, Brain KB,
 * create dialog, and auto-open on startup. Replaces the former App.tsx-only
 * handleProjectOpened path and BrainWikiPanel.bindProject shortcut.
 */
export async function openWikiProject(
  proj: WikiProject,
  options: OpenWikiProjectOptions = {},
): Promise<OpenWikiProjectResult> {
  const source = options.source ?? "welcome"

  const { resetProjectState } = await import("@/lib/reset-project-state")
  await resetProjectState()

  const {
    setProject,
    setSelectedFile,
    setActiveView,
    setFileTree,
    bumpDataVersion,
    setOutputLanguage,
    setScheduledImportConfig,
    setSourceWatchConfig,
  } = useWikiStore.getState()

  setProject(proj)
  const projectOutputLang = await loadOutputLanguage(proj.id)
  setOutputLanguage(projectOutputLang ?? "auto")
  setSelectedFile(null)
  setActiveView("wiki")
  bumpDataVersion()
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
    console.error(
      `[openWikiProject:${source}] Failed to restore ingest queue:`,
      err,
    )
  }

  // Same handshake for the dedup-merge queue.
  import("@/lib/dedup-queue")
    .then(({ restoreQueue }) => {
      restoreQueue(proj.id, proj.path).catch((err) =>
        console.error(
          `[openWikiProject:${source}] Failed to restore dedup queue:`,
          err,
        ),
      )
    })
    .catch((err) =>
      console.error(
        `[openWikiProject:${source}] Failed to load dedup-queue:`,
        err,
      ),
    )

  // Load per-project scheduled import config
  try {
    const savedScheduledImport = await loadScheduledImportConfig(proj.path)
    if (savedScheduledImport) {
      // Migrate relative path to absolute (backward compatibility)
      let path = savedScheduledImport.path
      if (path && !path.startsWith("/") && !path.match(/^[a-zA-Z]:[/\\]/)) {
        path = `${proj.path}/${path}`
      }
      setScheduledImportConfig({
        ...savedScheduledImport,
        path,
      })
    } else {
      setScheduledImportConfig({
        enabled: false,
        path: `${proj.path}/raw/sources`,
        interval: 60,
        lastScan: null,
      })
    }
  } catch {
    // ignore
  }

  const scheduledImportConfig = useWikiStore.getState().scheduledImportConfig
  if (
    scheduledImportConfig.enabled &&
    scheduledImportConfig.path &&
    scheduledImportConfig.interval > 0
  ) {
    import("@/lib/scheduled-import")
      .then(({ startScheduledImport }) => {
        startScheduledImport(proj, scheduledImportConfig)
      })
      .catch((err) =>
        console.error(
          `[openWikiProject:${source}] Failed to start scheduled import:`,
          err,
        ),
      )
  }

  import("@/lib/project-file-sync")
    .then(async ({ startProjectFileSync, stopProjectFileSync }) => {
      const config = await loadSourceWatchConfig(proj.id)
      setSourceWatchConfig(config)
      if (config.enabled) {
        startProjectFileSync(proj, config).catch((err) =>
          console.error(
            `[openWikiProject:${source}] Failed to start project file sync:`,
            err,
          ),
        )
      } else {
        stopProjectFileSync().catch(() => {})
      }
    })
    .catch((err) =>
      console.error(
        `[openWikiProject:${source}] Failed to configure project file sync:`,
        err,
      ),
    )

  let fileTreeLoaded = false
  try {
    const tree = await listDirectory(proj.path)
    setFileTree(tree)
    fileTreeLoaded = true
  } catch (err) {
    console.error(`[openWikiProject:${source}] Failed to load file tree:`, err)
  }

  try {
    const savedReview = await loadReviewItems(proj.path)
    if (savedReview.length > 0) {
      useReviewStore.getState().setItems(savedReview)
    }
  } catch {
    // ignore, start fresh
  }

  useLintStore.getState().setItems([])
  try {
    const savedLint = await loadLintItems(proj.path)
    useLintStore.getState().setItems(savedLint)
  } catch {
    useLintStore.getState().setItems([])
  }

  try {
    const savedChat = await loadChatHistory(proj.path)
    if (savedChat.conversations.length > 0) {
      useChatStore.getState().setConversations(savedChat.conversations)
      useChatStore.getState().setMessages(savedChat.messages)
      const sorted = [...savedChat.conversations].sort(
        (a, b) => b.updatedAt - a.updatedAt,
      )
      if (sorted[0]) {
        useChatStore.getState().setActiveConversation(sorted[0].id)
      }
    }
  } catch {
    // ignore, start fresh
  }

  return { fileTreeLoaded }
}
