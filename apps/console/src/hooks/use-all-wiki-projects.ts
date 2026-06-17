import { useCallback, useEffect, useState } from "react"
import {
  resolveAllRegisteredWikiProjects,
  type InboxChatWikiStatus,
  type ResolvedWikiProject,
} from "@/lib/resolve-inbox-chat-wiki"

type AllWikiProjectsState = {
  status: InboxChatWikiStatus
  loading: boolean
  resolved: ResolvedWikiProject[]
  invalidAliases: string[]
}

const INITIAL: AllWikiProjectsState = {
  status: "unbound",
  loading: false,
  resolved: [],
  invalidAliases: [],
}

/** All wikis registered in wiki-registry — not scoped to a chat. */
export function useAllWikiProjects() {
  const [state, setState] = useState<AllWikiProjectsState>(INITIAL)

  const reload = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    try {
      const result = await resolveAllRegisteredWikiProjects()
      setState({
        loading: false,
        status: result.status,
        resolved: result.resolved,
        invalidAliases: result.invalidAliases,
      })
    } catch {
      setState({
        loading: false,
        status: "broken",
        resolved: [],
        invalidAliases: [],
      })
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  return { ...state, reload }
}
