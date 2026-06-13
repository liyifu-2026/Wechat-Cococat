import { useCallback, useEffect, useRef, useState } from "react"
import { readFile, writeFile } from "@/commands/fs"
import { getFileCategory } from "@/lib/file-types"
import { wikiSaveRegistry } from "@/lib/wiki-file-save-registry"
import { useWikiStore } from "@/stores/wiki-store"

export const WIKI_FILE_SAVE_DEBOUNCE_MS = 1000

export interface UseWikiFileEditorOptions {
  /** Sync successful writes into wiki-store fileContent (PreviewPanel + Brain). */
  syncStore?: boolean
}

export interface WikiFileSaveOptions {
  immediate?: boolean
}

export function shouldSkipWikiSave(markdown: string, lastLoaded: string): boolean {
  return markdown === lastLoaded
}

/**
 * Unified read / debounced write / flush for BrainKbEditor and PreviewPanel.
 * Preserves lastLoaded no-op guard (Milkdown may still re-emit after WikiEditorInner filter).
 */
export function useWikiFileEditor(
  filePath: string | null,
  options: UseWikiFileEditorOptions = {},
) {
  const syncStore = options.syncStore ?? true
  const setFileContent = useWikiStore((s) => s.setFileContent)

  const [content, setContent] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastLoadedRef = useRef("")
  const pendingMarkdownRef = useRef<string | null>(null)
  const filePathRef = useRef<string | null>(filePath)

  useEffect(() => {
    filePathRef.current = filePath
  }, [filePath])

  const clearDebounceTimer = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
  }, [])

  const writeNow = useCallback(
    async (path: string, markdown: string) => {
      await writeFile(path, markdown)
      lastLoadedRef.current = markdown
      pendingMarkdownRef.current = null
      if (syncStore) {
        setFileContent(markdown)
      }
      setContent(markdown)
      wikiSaveRegistry.unregister(path)
    },
    [setFileContent, syncStore],
  )

  const flush = useCallback(async (pathOverride?: string): Promise<void> => {
    const path = pathOverride ?? filePathRef.current
    const markdown = pendingMarkdownRef.current
    clearDebounceTimer()
    if (!path || markdown === null) return
    if (shouldSkipWikiSave(markdown, lastLoadedRef.current)) {
      pendingMarkdownRef.current = null
      wikiSaveRegistry.unregister(path)
      return
    }
    try {
      await writeNow(path, markdown)
    } catch (err) {
      console.error(`[useWikiFileEditor] Failed to save ${path}:`, err)
      throw err
    }
  }, [clearDebounceTimer, writeNow])

  const registerPendingFlush = useCallback(
    (path: string) => {
      wikiSaveRegistry.register(path, flush)
    },
    [flush],
  )

  const handleSave = useCallback(
    (markdown: string, opts?: WikiFileSaveOptions) => {
      const path = filePathRef.current
      if (!path) return
      if (shouldSkipWikiSave(markdown, lastLoadedRef.current)) return

      pendingMarkdownRef.current = markdown
      setContent(markdown)
      registerPendingFlush(path)
      clearDebounceTimer()

      if (opts?.immediate) {
        void flush()
        return
      }

      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null
        void flush()
      }, WIKI_FILE_SAVE_DEBOUNCE_MS)
    },
    [clearDebounceTimer, flush, registerPendingFlush],
  )

  useEffect(() => {
    let cancelled = false
    const pathForThisEffect = filePath

    async function loadFile() {
      clearDebounceTimer()
      pendingMarkdownRef.current = null

      if (!filePath) {
        lastLoadedRef.current = ""
        setContent("")
        setError(null)
        setLoading(false)
        if (syncStore) setFileContent("")
        return
      }

      const category = getFileCategory(filePath)
      if (category !== "markdown") {
        lastLoadedRef.current = ""
        setContent("")
        setError(null)
        setLoading(false)
        if (syncStore) setFileContent("")
        return
      }

      setLoading(true)
      setError(null)
      try {
        const text = await readFile(filePath)
        if (cancelled) return
        lastLoadedRef.current = text
        pendingMarkdownRef.current = null
        setContent(text)
        if (syncStore) setFileContent(text)
        wikiSaveRegistry.unregister(filePath)
      } catch (err) {
        if (cancelled) return
        lastLoadedRef.current = ""
        const message = `Error loading file: ${err}`
        setContent(message)
        setError(message)
        if (syncStore) setFileContent(message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadFile()

    return () => {
      cancelled = true
      clearDebounceTimer()
      void flush(pathForThisEffect ?? undefined)
    }
  }, [filePath, clearDebounceTimer, flush, setFileContent, syncStore])

  return {
    content,
    loading,
    error,
    handleSave,
    flush,
  }
}
