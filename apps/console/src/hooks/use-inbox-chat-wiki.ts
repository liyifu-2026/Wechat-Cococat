import { useCallback, useEffect, useState } from "react"
import { encodeChatDir } from "@cococat/shared/chat-id"
import { readAgentChatFile } from "@/lib/agent-config-client"
import {
  parseChatWikiProjects,
  resolveInboxChatWikiProjects,
  type InboxChatWikiStatus,
  type ResolvedWikiProject,
} from "@/lib/resolve-inbox-chat-wiki"

export type InboxChatWikiState = {
  status: InboxChatWikiStatus
  loading: boolean
  aliases: string[]
  resolved: ResolvedWikiProject[]
  invalidAliases: string[]
  dirName: string | null
}

const INITIAL: InboxChatWikiState = {
  status: "unbound",
  loading: false,
  aliases: [],
  resolved: [],
  invalidAliases: [],
  dirName: null,
}

export function useInboxChatWiki(chatId: string | null) {
  const [state, setState] = useState<InboxChatWikiState>(INITIAL)

  const reload = useCallback(async () => {
    if (!chatId) {
      setState({ ...INITIAL, loading: false })
      return
    }

    const dirName = encodeChatDir(chatId)
    setState((s) => ({ ...s, loading: true, dirName }))

    try {
      const raw = await readAgentChatFile(dirName, "wiki.json")
      const aliases = parseChatWikiProjects(raw)
      const result = await resolveInboxChatWikiProjects(aliases)
      setState({
        loading: false,
        dirName,
        status: result.status,
        aliases: result.aliases,
        resolved: result.resolved,
        invalidAliases: result.invalidAliases,
      })
    } catch {
      setState({
        loading: false,
        dirName,
        status: "broken",
        aliases: [],
        resolved: [],
        invalidAliases: [],
      })
    }
  }, [chatId])

  useEffect(() => {
    void reload()
  }, [reload])

  return { ...state, reload }
}
