import { useEffect, useRef } from "react"
import { runStackOrchestrator } from "@/lib/stack-orchestrator"

/** Stop the service stack when the Console shell unmounts (app quit). */
export function useStackLifecycle() {
  const startedRef = useRef(false)

  useEffect(() => {
    startedRef.current = true
    return () => {
      if (!startedRef.current) return
      void runStackOrchestrator("stop", () => {}).catch((err) => {
        console.warn("[stack-lifecycle] stop on exit failed:", err)
      })
    }
  }, [])
}
