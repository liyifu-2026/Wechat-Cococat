import { useEffect, useRef } from "react"
import type { VisibilityGatingOptions } from "@/lib/visibility-gate"
import { resolveGatedDelayMs } from "@/lib/visibility-gate"
import { useConsoleStore } from "@/stores/console-store"

/**
 * Phase 6C: visibility + activeModule gated polling.
 * Only visible, relevant surfaces should hit the network stack.
 */
export function useVisibilityGatedInterval(
  callback: () => void | Promise<void>,
  delayMs: number,
  options: VisibilityGatingOptions = {},
) {
  const activeModule = useConsoleStore((s) => s.activeModule)
  const savedCallback = useRef(callback)
  savedCallback.current = callback

  const allowedKey = options.allowedModules?.join(",") ?? ""
  const suspendWhenHidden = options.suspendWhenHidden ?? true
  const degradedIntervalMs = options.degradedIntervalMs

  useEffect(() => {
    if (delayMs <= 0) return

    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const gateContext = () => ({
      hidden: document.hidden,
      activeModule: useConsoleStore.getState().activeModule,
    })

    const scheduleNext = () => {
      if (cancelled) return
      if (timer) clearTimeout(timer)
      timer = null

      const delay = resolveGatedDelayMs(delayMs, gateContext(), options)
      if (delay === null) return

      timer = setTimeout(() => {
        void (async () => {
          if (cancelled) return
          await savedCallback.current()
          scheduleNext()
        })()
      }, delay)
    }

    const runNowAndSchedule = () => {
      if (cancelled) return
      const delay = resolveGatedDelayMs(delayMs, gateContext(), options)
      if (delay === null) return
      void (async () => {
        await savedCallback.current()
        scheduleNext()
      })()
    }

    runNowAndSchedule()

    const onVisibilityChange = () => {
      if (timer) clearTimeout(timer)
      timer = null
      if (!document.hidden) {
        runNowAndSchedule()
      } else {
        scheduleNext()
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange)

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [delayMs, activeModule, allowedKey, suspendWhenHidden, degradedIntervalMs])
}
