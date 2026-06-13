import { useCallback, useState } from "react"
import {
  listConsoleEvents,
  type ConsoleEventDto,
} from "@/lib/console-events-client"
import { useVisibilityGatedInterval } from "@/hooks/use-visibility-gated-interval"

export function useConsoleEvents(pollMs = 30_000, maxLines = 120) {
  const [events, setEvents] = useState<ConsoleEventDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      setEvents(await listConsoleEvents(maxLines))
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [maxLines])

  useVisibilityGatedInterval(() => void refresh(), pollMs, {
    allowedModules: ["overview"],
    suspendWhenHidden: true,
  })

  return { events, loading, error, refresh }
}
