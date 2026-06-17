/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest"
import {
  COMPOSE_CARET_ANCHOR,
  COMPOSE_EMOJI_WIDGET_CLASS,
  extractDraftFromEditor,
  handleComposeEmojiKeyDown,
  insertEmojiAtSelection,
  setEditorFromDraft,
} from "@/lib/inbox-compose-editor"

describe("inbox-compose-editor", () => {
  it("round-trips draft text with emoji widgets", () => {
    const root = document.createElement("div")
    const draft = "你好[微笑]呀"
    setEditorFromDraft(root, draft)

    expect(root.querySelector(`.${COMPOSE_EMOJI_WIDGET_CLASS}`)).not.toBeNull()
    expect(extractDraftFromEditor(root)).toBe(draft)
  })

  it("preserves newlines and multiple emojis", () => {
    const root = document.createElement("div")
    const draft = "A[微笑]\nB[大哭]C"
    setEditorFromDraft(root, draft)
    expect(extractDraftFromEditor(root)).toBe(draft)
  })

  it("inserts emoji widget with caret anchor so typing can continue", () => {
    const root = document.createElement("div")
    document.body.appendChild(root)

    insertEmojiAtSelection(root, "[微笑]")

    const widget = root.querySelector(`.${COMPOSE_EMOJI_WIDGET_CLASS}`)
    expect(widget).not.toBeNull()
    expect(widget?.nextSibling?.textContent).toBe(COMPOSE_CARET_ANCHOR)
    expect(extractDraftFromEditor(root)).toBe("[微笑]")

    root.remove()
  })

  it("deletes emoji atomically with Backspace from caret anchor", () => {
    const root = document.createElement("div")
    insertEmojiAtSelection(root, "[微笑]")

    const sel = window.getSelection()!
    const anchor = root.lastChild as Text
    sel.removeAllRanges()
    const range = document.createRange()
    range.setStart(anchor, anchor.length)
    range.collapse(true)
    sel.addRange(range)

    const handled = handleComposeEmojiKeyDown(root, {
      key: "Backspace",
      preventDefault: () => {},
    } as KeyboardEvent)

    expect(handled).toBe(true)
    expect(extractDraftFromEditor(root)).toBe("")
  })
})
