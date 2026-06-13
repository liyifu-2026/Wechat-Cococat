import { useEffect, useState } from "react"
import { useWikiStore } from "@/stores/wiki-store"
import { readFile } from "@/commands/fs"
import { getFileCategory, isBinary, isExtractedTextPreviewFile } from "@/lib/file-types"
import { WikiEditor } from "@/components/editor/wiki-editor"
import { FilePreview } from "@/components/editor/file-preview"
import { getFileName } from "@/lib/path-utils"
import { useWikiFileEditor } from "@/hooks/use-wiki-file-editor"
import { X } from "lucide-react"

export function PreviewPanel() {
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const fileContent = useWikiStore((s) => s.fileContent)
  const externalPreview = useWikiStore((s) => s.externalPreview)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)

  const isExternal = !!selectedFile && externalPreview?.path === selectedFile
  const category = selectedFile ? getFileCategory(selectedFile) : null
  const isEditableMarkdown =
    !!selectedFile &&
    !isExternal &&
    category === "markdown"

  const { content: editorContent, handleSave } = useWikiFileEditor(
    isEditableMarkdown ? selectedFile : null,
    { syncStore: true },
  )

  const [previewText, setPreviewText] = useState("")

  useEffect(() => {
    if (!selectedFile || isExternal || isEditableMarkdown) {
      setPreviewText("")
      return
    }
    const cat = getFileCategory(selectedFile)
    if (isBinary(cat) && !isExtractedTextPreviewFile(selectedFile)) {
      setPreviewText("")
      return
    }
    let cancelled = false
    readFile(selectedFile)
      .then((text) => {
        if (!cancelled) setPreviewText(text)
      })
      .catch(() => {
        if (!cancelled) setPreviewText("")
      })
    return () => {
      cancelled = true
    }
  }, [selectedFile, isExternal, isEditableMarkdown])

  if (!selectedFile) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Select a file to preview
      </div>
    )
  }

  const fileName = isExternal
    ? externalPreview!.title
    : getFileName(selectedFile)

  const previewTextContent = isExternal
    ? fileContent
    : isEditableMarkdown
      ? editorContent
      : previewText

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b px-3 py-1.5">
        <span className="truncate text-xs text-muted-foreground" title={selectedFile}>
          {fileName}
        </span>
        <button
          onClick={() => setSelectedFile(null)}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex-1 min-w-0 overflow-auto">
        {isExternal ? (
          <ExternalReferencePreview
            source={externalPreview!.source}
            title={externalPreview!.title}
            path={externalPreview!.url}
            snippet={externalPreview!.snippet || fileContent}
          />
        ) : isEditableMarkdown ? (
          <WikiEditor
            key={selectedFile}
            content={editorContent}
            onSave={handleSave}
          />
        ) : category && isBinary(category) && !isExtractedTextPreviewFile(selectedFile) ? (
          <FilePreview
            key={selectedFile}
            filePath={selectedFile}
            textContent={previewTextContent}
          />
        ) : (
          <FilePreview
            key={selectedFile}
            filePath={selectedFile}
            textContent={previewTextContent}
          />
        )}
      </div>
    </div>
  )
}

function ExternalReferencePreview({
  source,
  title,
  path,
  snippet,
}: {
  source: string
  title: string
  path: string
  snippet: string
}) {
  return (
    <div className="flex h-full flex-col overflow-auto p-6">
      <div className="mb-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
            {source}
          </span>
          <h3 className="truncate text-sm font-medium" title={title}>{title}</h3>
        </div>
        <div className="break-all rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
          {path}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-border/60 bg-background p-4">
        <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-6">
          {snippet || "(No preview fragment returned.)"}
        </pre>
      </div>
    </div>
  )
}
