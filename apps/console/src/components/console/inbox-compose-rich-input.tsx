import {
  forwardRef,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
} from "react"
import {
  extractDraftFromEditor,
  handleComposeCopy,
  handleComposeEmojiKeyDown,
  handleComposePaste,
  insertEmojiAtSelection,
  insertTextAtSelection,
  normalizeEmojiInEditor,
  placeCaretAtEnd,
  setEditorFromDraft,
} from "@/lib/inbox-compose-editor"
import { cn } from "@/lib/utils"

export type InboxComposeRichInputHandle = {
  focus: () => void
  insertSnippet: (text: string) => void
  getScrollHeight: () => number
}

type InboxComposeRichInputProps = {
  value: string
  onChange: (value: string) => void
  onKeyDown?: (event: React.KeyboardEvent<HTMLDivElement>) => void
  placeholder?: string
  disabled?: boolean
  readOnly?: boolean
  dir?: "auto" | "ltr" | "rtl"
  className?: string
  minRows?: number
}

const BASE_CLASS =
  "inbox-compose-rich-input min-h-0 w-full flex-1 overflow-y-auto border-0 bg-transparent px-3 py-0 text-sm leading-relaxed text-[var(--wx-text)] shadow-none outline-none focus:ring-0 disabled:cursor-not-allowed disabled:opacity-60 empty:before:text-[var(--wx-muted)]"

export const InboxComposeRichInput = forwardRef<
  InboxComposeRichInputHandle,
  InboxComposeRichInputProps
>(function InboxComposeRichInput(
  {
    value,
    onChange,
    onKeyDown,
    placeholder,
    disabled = false,
    readOnly = false,
    dir = "auto",
    className,
    minRows = 2,
  },
  ref,
) {
  const editorRef = useRef<HTMLDivElement>(null)
  const composingRef = useRef(false)
  /** Draft emitted locally but parent `value` may still be stale for one frame. */
  const pendingEmitRef = useRef<string | null>(null)

  const syncFromEditor = useCallback(() => {
    const root = editorRef.current
    if (!root) return
    const next = extractDraftFromEditor(root)
    pendingEmitRef.current = next
    onChange(next)
  }, [onChange])

  useLayoutEffect(() => {
    const root = editorRef.current
    if (!root) return

    const current = extractDraftFromEditor(root)

    if (pendingEmitRef.current !== null) {
      if (value !== pendingEmitRef.current) {
        return
      }
      if (current === value) {
        pendingEmitRef.current = null
        return
      }
      setEditorFromDraft(root, value)
      pendingEmitRef.current = null
      placeCaretAtEnd(root)
      return
    }

    if (current === value) return
    setEditorFromDraft(root, value)
  }, [value])

  useImperativeHandle(
    ref,
    () => ({
      focus: () => editorRef.current?.focus(),
      insertSnippet: (text: string) => {
        const root = editorRef.current
        if (!root || disabled || readOnly) return
        if (/^\[[^\]]+\]$/.test(text)) {
          insertEmojiAtSelection(root, text)
        } else {
          insertTextAtSelection(root, text)
        }
        normalizeEmojiInEditor(root)
        syncFromEditor()
        root.focus()
        requestAnimationFrame(() => placeCaretAtEnd(root))
      },
      getScrollHeight: () => editorRef.current?.scrollHeight ?? 0,
    }),
    [disabled, readOnly, syncFromEditor],
  )

  const handleInput = useCallback(() => {
    if (composingRef.current) return
    const root = editorRef.current
    if (!root) return
    normalizeEmojiInEditor(root)
    syncFromEditor()
  }, [syncFromEditor])

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const root = editorRef.current
      if (root && handleComposeEmojiKeyDown(root, event.nativeEvent)) {
        syncFromEditor()
        return
      }
      onKeyDown?.(event)
    },
    [onKeyDown, syncFromEditor],
  )

  return (
    <div
      ref={editorRef}
      role="textbox"
      aria-multiline="true"
      aria-placeholder={placeholder}
      contentEditable={!(disabled || readOnly)}
      suppressContentEditableWarning
      dir={dir}
      data-placeholder={placeholder ?? ""}
      className={cn(BASE_CLASS, className)}
      style={{ minHeight: `${minRows * 1.625}rem` }}
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      onCompositionStart={() => {
        composingRef.current = true
      }}
      onCompositionEnd={() => {
        composingRef.current = false
        const root = editorRef.current
        if (!root) return
        normalizeEmojiInEditor(root)
        syncFromEditor()
      }}
      onCopy={(event) => {
        const root = editorRef.current
        if (root) handleComposeCopy(root, event.nativeEvent)
      }}
      onPaste={(event) => {
        const root = editorRef.current
        if (!root) return
        handleComposePaste(root, event.nativeEvent, syncFromEditor)
      }}
    />
  )
})
