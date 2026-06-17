import { useCallback, useEffect, useState } from "react"

export type ChatLayoutPreferences = {
  pinnedAt: Record<string, number>
}

const DEFAULT_PREFS: ChatLayoutPreferences = { pinnedAt: {} }

function storageKey(username: string, suffix = ""): string {
  const id = username.trim() || "default"
  return `cococat.chat-layout:${id}${suffix}`
}

function readPrefs(key: string): ChatLayoutPreferences {
  try {
    const saved = localStorage.getItem(key)
    if (!saved) return { ...DEFAULT_PREFS }
    const parsed = JSON.parse(saved) as Partial<ChatLayoutPreferences>
    return {
      pinnedAt:
        parsed.pinnedAt && typeof parsed.pinnedAt === "object"
          ? parsed.pinnedAt
          : {},
    }
  } catch {
    return { ...DEFAULT_PREFS }
  }
}

export function useChatListLayout(loggedInUser: string | null | undefined) {
  const wxid = loggedInUser?.trim() || "default"
  const prefsKey = storageKey(wxid)
  const collapsedKey = storageKey(wxid, ":collapsed")

  const [preferences, setPreferences] = useState<ChatLayoutPreferences>(() =>
    readPrefs(prefsKey),
  )
  const [isPinnedSectionCollapsed, setIsPinnedSectionCollapsed] = useState(
    () => {
      try {
        return localStorage.getItem(collapsedKey) === "true"
      } catch {
        return false
      }
    },
  )

  useEffect(() => {
    setPreferences(readPrefs(prefsKey))
    try {
      setIsPinnedSectionCollapsed(
        localStorage.getItem(collapsedKey) === "true",
      )
    } catch {
      setIsPinnedSectionCollapsed(false)
    }
  }, [prefsKey, collapsedKey])

  const togglePin = useCallback(
    (chatId: string) => {
      setPreferences((prev) => {
        const nextPinned = { ...prev.pinnedAt }
        if (nextPinned[chatId]) {
          delete nextPinned[chatId]
        } else {
          nextPinned[chatId] = Date.now()
        }
        const updated = { pinnedAt: nextPinned }
        localStorage.setItem(prefsKey, JSON.stringify(updated))
        return updated
      })
    },
    [prefsKey],
  )

  const setCollapsed = useCallback(
    (collapsed: boolean) => {
      setIsPinnedSectionCollapsed(collapsed)
      localStorage.setItem(collapsedKey, String(collapsed))
    },
    [collapsedKey],
  )

  const isPinned = useCallback(
    (chatId: string) => (preferences.pinnedAt[chatId] ?? 0) > 0,
    [preferences.pinnedAt],
  )

  return {
    preferences,
    isPinnedSectionCollapsed,
    togglePin,
    setCollapsed,
    isPinned,
  }
}
