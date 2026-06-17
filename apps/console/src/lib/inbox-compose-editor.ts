import { emojiMap, type WechatEmoji } from "wechat-emoji-renderer"
import { renderComposeEmojiWidgetHtml } from "@/lib/wechat-emoji-config"

export const COMPOSE_EMOJI_WIDGET_CLASS = "inbox-compose-emoji-widget"
export const COMPOSE_EMOJI_CODE_RE = /\[[^\]]+\]/g

/** One line of `text-sm` — sized to read as a single character in the compose field. */
export const COMPOSE_EMOJI_EM_PX = 22

/** Invisible anchor so the caret can stay in an editable text node after widgets. */
export const COMPOSE_CARET_ANCHOR = "\u200B"

export function createEmojiWidget(code: string): HTMLSpanElement | null {
  const emoji = emojiMap.get(code)
  if (!emoji) return null
  return buildEmojiWidget(emoji)
}

function buildEmojiWidget(emoji: WechatEmoji): HTMLSpanElement {
  const html = renderComposeEmojiWidgetHtml(
    emoji.code,
    COMPOSE_EMOJI_EM_PX,
    COMPOSE_EMOJI_WIDGET_CLASS,
  )
  const holder = document.createElement("div")
  if (!html) {
    const fallback = document.createElement("span")
    fallback.textContent = emoji.code
    fallback.contentEditable = "false"
    fallback.dataset.emojiCode = emoji.code
    return fallback
  }
  holder.innerHTML = html
  const span = holder.querySelector("span")
  if (!span) {
    const fallback = document.createElement("span")
    fallback.textContent = emoji.code
    return fallback
  }
  span.contentEditable = "false"
  span.dataset.emojiCode = emoji.code
  return span
}

function stripCaretAnchors(text: string): string {
  return text.replace(/\u200B/g, "")
}

function isCaretAnchorOnly(text: string): boolean {
  return stripCaretAnchors(text) === ""
}

function applySelectionRange(range: Range) {
  const sel = window.getSelection()
  sel?.removeAllRanges()
  sel?.addRange(range)
}

function ensureCaretAnchorAfter(node: Node): Text {
  const next = node.nextSibling
  if (next?.nodeType === Node.TEXT_NODE) {
    const text = next as Text
    if (!(text.textContent ?? "").includes(COMPOSE_CARET_ANCHOR)) {
      text.textContent = `${text.textContent ?? ""}${COMPOSE_CARET_ANCHOR}`
    }
    return text
  }
  const text = document.createTextNode(COMPOSE_CARET_ANCHOR)
  node.parentNode?.insertBefore(text, next)
  return text
}

export function ensureTrailingCaretAnchor(root: HTMLElement): Text | null {
  if (root.childNodes.length === 0) return null

  const last = root.lastChild!
  if (isEmojiWidget(last)) {
    return ensureCaretAnchorAfter(last)
  }
  if (last.nodeType === Node.TEXT_NODE) {
    const text = last as Text
    if (!(text.textContent ?? "").endsWith(COMPOSE_CARET_ANCHOR)) {
      text.textContent = `${text.textContent ?? ""}${COMPOSE_CARET_ANCHOR}`
    }
    return text
  }
  const text = document.createTextNode(COMPOSE_CARET_ANCHOR)
  root.appendChild(text)
  return text
}

export function placeCaretAtEnd(root: HTMLElement) {
  const anchor = ensureTrailingCaretAnchor(root)
  if (!anchor) {
    const range = document.createRange()
    range.selectNodeContents(root)
    range.collapse(false)
    applySelectionRange(range)
    return
  }
  const range = document.createRange()
  range.setStart(anchor, anchor.length)
  range.collapse(true)
  applySelectionRange(range)
}

function placeCaretAfterNode(node: Node) {
  const anchor = ensureCaretAnchorAfter(node)
  const range = document.createRange()
  range.setStart(anchor, anchor.length)
  range.collapse(true)
  applySelectionRange(range)
}

function pruneLoneBreak(root: HTMLElement) {
  if (
    root.childNodes.length === 1 &&
    root.firstChild?.nodeName === "BR"
  ) {
    root.replaceChildren()
  }
}

function appendParsedLine(root: HTMLElement, line: string) {
  COMPOSE_EMOJI_CODE_RE.lastIndex = 0
  let last = 0
  let match: RegExpExecArray | null

  while ((match = COMPOSE_EMOJI_CODE_RE.exec(line)) !== null) {
    if (match.index > last) {
      root.appendChild(document.createTextNode(line.slice(last, match.index)))
    }
    const code = match[0]
    root.appendChild(createEmojiWidget(code) ?? document.createTextNode(code))
    last = match.index + code.length
  }

  if (last < line.length) {
    root.appendChild(document.createTextNode(line.slice(last)))
  }
}

export function setEditorFromDraft(root: HTMLElement, draft: string) {
  root.replaceChildren()
  if (!draft) return

  const lines = draft.split("\n")
  lines.forEach((line, index) => {
    if (index > 0) root.appendChild(document.createElement("br"))
    appendParsedLine(root, line)
  })
  ensureTrailingCaretAnchor(root)
}

function visitNode(node: Node, out: string[]) {
  if (node.nodeType === Node.TEXT_NODE) {
    out.push(stripCaretAnchors(node.textContent ?? ""))
    return
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return

  const el = node as HTMLElement
  const code = el.dataset.emojiCode
  if (code) {
    out.push(code)
    return
  }
  if (el.tagName === "BR") {
    out.push("\n")
    return
  }
  for (const child of el.childNodes) visitNode(child, out)
}

export function extractDraftFromEditor(root: HTMLElement): string {
  const parts: string[] = []
  const children = [...root.childNodes]

  children.forEach((child, index) => {
    if (
      index > 0 &&
      child.nodeType === Node.ELEMENT_NODE &&
      (child as HTMLElement).tagName === "DIV"
    ) {
      parts.push("\n")
    }
    visitNode(child, parts)
  })

  return parts.join("")
}

export function normalizeEmojiInEditor(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const textNodes: Text[] = []
  let current: Node | null
  while ((current = walker.nextNode())) {
    textNodes.push(current as Text)
  }

  for (const textNode of textNodes) {
    const parent = textNode.parentElement
    if (!parent || parent.closest(`.${COMPOSE_EMOJI_WIDGET_CLASS}`)) continue

    const text = textNode.textContent ?? ""
    COMPOSE_EMOJI_CODE_RE.lastIndex = 0
    if (!COMPOSE_EMOJI_CODE_RE.test(text)) continue
    COMPOSE_EMOJI_CODE_RE.lastIndex = 0

    const fragment = document.createDocumentFragment()
    let last = 0
    let match: RegExpExecArray | null

    while ((match = COMPOSE_EMOJI_CODE_RE.exec(text)) !== null) {
      if (match.index > last) {
        fragment.appendChild(document.createTextNode(text.slice(last, match.index)))
      }
      const code = match[0]
      fragment.appendChild(
        createEmojiWidget(code) ?? document.createTextNode(code),
      )
      last = match.index + code.length
    }

    if (last < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(last)))
    }

    parent.replaceChild(fragment, textNode)
  }
}

function getSelectionRange(root: HTMLElement): Range | null {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0) return null
  const range = sel.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return null
  return range
}

function resolveInsertRange(root: HTMLElement): Range {
  const existing = getSelectionRange(root)
  if (existing) return existing

  pruneLoneBreak(root)
  const range = document.createRange()
  range.selectNodeContents(root)
  range.collapse(false)
  return range
}

export function insertTextAtSelection(root: HTMLElement, text: string) {
  root.focus()
  const range = resolveInsertRange(root)
  range.deleteContents()
  const node = document.createTextNode(text)
  range.insertNode(node)
  const rangeAfter = document.createRange()
  rangeAfter.setStart(node, node.length)
  rangeAfter.collapse(true)
  applySelectionRange(rangeAfter)
}

export function insertEmojiAtSelection(root: HTMLElement, code: string) {
  const widget = createEmojiWidget(code)
  if (!widget) {
    insertTextAtSelection(root, code)
    return
  }

  root.focus()
  const range = resolveInsertRange(root)
  range.deleteContents()
  range.insertNode(widget)
  placeCaretAfterNode(widget)
}

export function extractDraftFromSelection(root: HTMLElement): string {
  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
    return extractDraftFromEditor(root)
  }

  const range = sel.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) {
    return extractDraftFromEditor(root)
  }

  const fragment = range.cloneContents()
  const holder = document.createElement("div")
  holder.appendChild(fragment)
  return extractDraftFromEditor(holder)
}

export function handleComposeCopy(root: HTMLElement, event: ClipboardEvent) {
  const sel = window.getSelection()
  if (!sel || sel.isCollapsed) return
  const text = extractDraftFromSelection(root)
  event.clipboardData?.setData("text/plain", text)
  event.preventDefault()
}

export function handleComposePaste(
  root: HTMLElement,
  event: ClipboardEvent,
  onSync: () => void,
) {
  const text = event.clipboardData?.getData("text/plain")
  if (text == null) return
  event.preventDefault()
  insertTextAtSelection(root, text)
  normalizeEmojiInEditor(root)
  onSync()
}

export function isEmojiWidget(node: Node | null): node is HTMLElement {
  return (
    node != null &&
    node.nodeType === Node.ELEMENT_NODE &&
    (node as HTMLElement).classList.contains(COMPOSE_EMOJI_WIDGET_CLASS)
  )
}

/** Backspace/Delete removes adjacent emoji widgets atomically. */
export function handleComposeEmojiKeyDown(
  root: HTMLElement,
  event: KeyboardEvent,
): boolean {
  if (event.key !== "Backspace" && event.key !== "Delete") return false

  const sel = window.getSelection()
  if (!sel || sel.rangeCount === 0 || !sel.isCollapsed) return false

  const range = sel.getRangeAt(0)
  if (!root.contains(range.commonAncestorContainer)) return false

  const { startContainer, startOffset } = range

  if (event.key === "Backspace") {
    if (startContainer.nodeType === Node.TEXT_NODE && startOffset > 0) {
      const text = startContainer.textContent ?? ""
      if (isCaretAnchorOnly(text)) {
        const before = startContainer.previousSibling
        if (isEmojiWidget(before)) {
          event.preventDefault()
          before.parentNode?.removeChild(before)
          startContainer.parentNode?.removeChild(startContainer)
          placeCaretAtEnd(root)
          return true
        }
      }
      return false
    }
    const before = resolveNodeBefore(root, startContainer, startOffset)
    if (isEmojiWidget(before)) {
      event.preventDefault()
      before.parentNode?.removeChild(before)
      if (
        startContainer.nodeType === Node.TEXT_NODE &&
        isCaretAnchorOnly(startContainer.textContent ?? "")
      ) {
        startContainer.parentNode?.removeChild(startContainer)
      }
      placeCaretAtEnd(root)
      return true
    }
  }

  if (event.key === "Delete") {
    if (startContainer.nodeType === Node.TEXT_NODE) {
      const text = startContainer.textContent ?? ""
      if (startOffset < text.length && !isCaretAnchorOnly(text)) {
        return false
      }
      if (isCaretAnchorOnly(text)) {
        const after = startContainer.nextSibling
        if (isEmojiWidget(after)) {
          event.preventDefault()
          after.parentNode?.removeChild(after)
          return true
        }
      }
    }
    const after = resolveNodeAfter(root, startContainer, startOffset)
    if (isEmojiWidget(after)) {
      event.preventDefault()
      after.parentNode?.removeChild(after)
      placeCaretAtEnd(root)
      return true
    }
  }

  return false
}

function resolveNodeBefore(
  root: HTMLElement,
  container: Node,
  offset: number,
): Node | null {
  if (container.nodeType === Node.TEXT_NODE && offset === 0) {
    return container.previousSibling
  }
  if (container === root && offset > 0) {
    return root.childNodes[offset - 1] ?? null
  }
  if (container.nodeType === Node.ELEMENT_NODE && offset > 0) {
    return container.childNodes[offset - 1] ?? null
  }
  return null
}

function resolveNodeAfter(
  root: HTMLElement,
  container: Node,
  offset: number,
): Node | null {
  if (
    container.nodeType === Node.TEXT_NODE &&
    offset >= (container.textContent?.length ?? 0)
  ) {
    return container.nextSibling
  }
  if (container === root) {
    return root.childNodes[offset] ?? null
  }
  if (container.nodeType === Node.ELEMENT_NODE) {
    return container.childNodes[offset] ?? null
  }
  return null
}
