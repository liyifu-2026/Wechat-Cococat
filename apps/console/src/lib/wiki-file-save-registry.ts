/**
 * PR-2: debounced wiki file saves — global flush registry for module navigation.
 */

type AsyncFlushFn = () => Promise<void>

const pendingSaves = new Map<string, AsyncFlushFn>()
let flushAllInFlight: Promise<void> | null = null

export const wikiSaveRegistry = {
  register(fileId: string, flushFn: AsyncFlushFn) {
    pendingSaves.set(fileId, flushFn)
  },

  unregister(fileId: string) {
    pendingSaves.delete(fileId)
  },

  async flushAll(): Promise<void> {
    if (pendingSaves.size === 0) return
    if (flushAllInFlight) return flushAllInFlight

    flushAllInFlight = (async () => {
      const fns = [...pendingSaves.values()]
      await Promise.all(
        fns.map((flush) =>
          flush().catch((err) => {
            console.error("[WikiSaveRegistry] flush failed:", err)
          }),
        ),
      )
    })().finally(() => {
      flushAllInFlight = null
    })

    return flushAllInFlight
  },

  /** Test-only introspection */
  getPendingCount(): number {
    return pendingSaves.size
  },

  /** Test-only reset */
  _clearForTests(): void {
    pendingSaves.clear()
    flushAllInFlight = null
  },
}
