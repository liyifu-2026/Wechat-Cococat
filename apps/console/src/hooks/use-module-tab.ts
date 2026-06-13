import { useCallback, useMemo, useState } from "react"
import { loadStoredTab, saveStoredTab } from "@/lib/console-layout"

export interface UseModuleTabOptions<T extends string> {
  storageKey: string
  allowed: readonly T[]
  defaultTab: T
  /** When set, overrides stored tab until cleared (e.g. WeChat not logged in → connect). */
  forcedTab?: T | null
}

/**
 * Per-module sub-tab state with localStorage persistence.
 * Part of Console layout infrastructure (PLAN-console-ux Phase 0).
 */
export function useModuleTab<T extends string>({
  storageKey,
  allowed,
  defaultTab,
  forcedTab = null,
}: UseModuleTabOptions<T>): [T, (tab: T) => void] {
  const initial = useMemo(
    () => loadStoredTab(storageKey, allowed, defaultTab),
    [storageKey, allowed, defaultTab],
  )

  const [storedTab, setStoredTab] = useState<T>(initial)

  const activeTab = forcedTab ?? storedTab

  const setActiveTab = useCallback(
    (tab: T) => {
      setStoredTab(tab)
      saveStoredTab(storageKey, tab)
    },
    [storageKey],
  )

  return [activeTab, setActiveTab]
}
