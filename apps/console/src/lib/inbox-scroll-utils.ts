export const SCROLL_BOTTOM_THRESHOLD = 80

export function isNearScrollBottom(el: HTMLElement): boolean {
  return (
    el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_BOTTOM_THRESHOLD
  )
}

/** Apply scrollTop after layout + image placeholders have settled. */
export function applyScrollTopWhenStable(
  el: HTMLElement,
  scrollTop: number,
): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.scrollTop = scrollTop
    })
  })
}

type BottomScrollSession = {
  token: number
  intervalId?: number
  timeoutId?: number
  observer?: ResizeObserver
}

const bottomScrollSessions = new WeakMap<HTMLElement, BottomScrollSession>()
let bottomScrollToken = 0

function scrollToMax(el: HTMLElement) {
  el.scrollTop = el.scrollHeight
}

function clearBottomScrollSession(el: HTMLElement) {
  const session = bottomScrollSessions.get(el)
  if (!session) return
  if (session.intervalId != null) window.clearInterval(session.intervalId)
  if (session.timeoutId != null) window.clearTimeout(session.timeoutId)
  session.observer?.disconnect()
  bottomScrollSessions.delete(el)
}

/** Stop any in-flight auto scroll-to-bottom (e.g. user scrolled up). */
export function cancelScrollToBottom(el: HTMLElement): void {
  bottomScrollToken += 1
  clearBottomScrollSession(el)
}

export function scrollToBottomWhenStable(el: HTMLElement): void {
  scrollToBottomReliable(el, "gentle")
}

export type ScrollToBottomMode = "gentle" | "aggressive"

/**
 * Scroll to the true bottom. Aggressive mode retries while media loads;
 * gentle mode is for live updates when already pinned to bottom.
 */
export function scrollToBottomReliable(
  el: HTMLElement,
  mode: ScrollToBottomMode = "aggressive",
): void {
  cancelScrollToBottom(el)

  const token = ++bottomScrollToken
  const session: BottomScrollSession = { token }
  bottomScrollSessions.set(el, session)

  const scroll = () => {
    if (token !== bottomScrollToken) return
    if (mode === "gentle" && !isNearScrollBottom(el)) return
    scrollToMax(el)
  }

  scroll()
  requestAnimationFrame(() => {
    scroll()
    requestAnimationFrame(scroll)
  })

  if (mode === "gentle") {
    session.timeoutId = window.setTimeout(() => {
      if (token === bottomScrollToken) clearBottomScrollSession(el)
    }, 240)
    return
  }

  let ticks = 0
  session.intervalId = window.setInterval(() => {
    scroll()
    ticks += 1
    if (ticks >= 8) {
      if (session.intervalId != null) window.clearInterval(session.intervalId)
      session.intervalId = undefined
    }
  }, 80)

  const content = el.firstElementChild
  if (content) {
    const observer = new ResizeObserver(() => scroll())
    observer.observe(content)
    session.observer = observer
  }

  session.timeoutId = window.setTimeout(() => {
    if (token === bottomScrollToken) clearBottomScrollSession(el)
  }, 1200)
}
