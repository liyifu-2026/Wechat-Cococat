import { useTranslation } from "react-i18next"
import { X } from "lucide-react"
import { useWikiStore } from "@/stores/wiki-store"
import { getFileCategory } from "@/lib/file-types"
import { WikiEditor } from "@/components/editor/wiki-editor"
import { getFileName } from "@/lib/path-utils"
import { useWikiFileEditor } from "@/hooks/use-wiki-file-editor"

interface BrainKbEditorProps {
  initialEditMode?: boolean
}

/** 大脑 · 知识 — 单页 Markdown 编辑（复用 WikiEditor 自动保存） */
export function BrainKbEditor({ initialEditMode = false }: BrainKbEditorProps) {
  const { t } = useTranslation()
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const setSelectedFile = useWikiStore((s) => s.setSelectedFile)

  const editablePath =
    selectedFile && getFileCategory(selectedFile) === "markdown"
      ? selectedFile
      : null

  const { content, handleSave } = useWikiFileEditor(editablePath, {
    syncStore: true,
  })

  if (!selectedFile) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        {t("console.brain.kbSelectPage")}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b px-3 py-2">
        <span className="truncate text-xs text-muted-foreground" title={selectedFile}>
          {getFileName(selectedFile)}
        </span>
        <button
          type="button"
          onClick={() => setSelectedFile(null)}
          className="shrink-0 rounded p-1 text-muted-foreground hover:bg-accent"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        <WikiEditor
          key={`${selectedFile}-${initialEditMode ? "edit" : "read"}`}
          content={content}
          onSave={handleSave}
          initialEditMode={initialEditMode}
        />
      </div>
    </div>
  )
}
