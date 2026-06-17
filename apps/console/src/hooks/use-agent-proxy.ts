import { useCallback, useEffect, useRef, useState } from "react"
import {
  readChatAgentProxyEnabled,
  setChatAgentProxyEnabled,
} from "@/lib/agent-config-client"

/**
 * Per-chat Agent 代理开关。本地 optimistic 态优先，避免轮询覆盖未提交的切换。
 */
export function useAgentProxy(chatId: string | null | undefined) {
  const [enabled, setEnabled] = useState(true)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pendingRef = useRef<boolean | null>(null)

  const load = useCallback(async () => {
    if (!chatId) {
      setEnabled(true)
      pendingRef.current = null
      return
    }
    if (pendingRef.current !== null) return
    setLoading(true)
    setError(null)
    try {
      setEnabled(await readChatAgentProxyEnabled(chatId))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [chatId])

  useEffect(() => {
    void load()
  }, [load])

  const setProxyEnabled = useCallback(
    async (next: boolean) => {
      if (!chatId || busy) return
      const prev = enabled
      pendingRef.current = next
      setEnabled(next)
      setBusy(true)
      setError(null)
      try {
        await setChatAgentProxyEnabled(chatId, next)
      } catch (err) {
        setEnabled(prev)
        setError(err instanceof Error ? err.message : String(err))
        throw err
      } finally {
        pendingRef.current = null
        setBusy(false)
      }
    },
    [chatId, busy, enabled],
  )

  return {
    agentProxyEnabled: enabled,
    loading,
    busy,
    error,
    reload: load,
    setAgentProxyEnabled: setProxyEnabled,
  }
}
