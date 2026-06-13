import { beforeEach, describe, expect, it, vi } from "vitest"
import { wikiSaveRegistry } from "./wiki-file-save-registry"

describe("wikiSaveRegistry (PR-2)", () => {
  beforeEach(() => {
    wikiSaveRegistry._clearForTests()
  })

  it("flushAll runs all registered flush callbacks", async () => {
    const first = vi.fn(async () => {})
    const second = vi.fn(async () => {})
    wikiSaveRegistry.register("/a.md", first)
    wikiSaveRegistry.register("/b.md", second)

    await wikiSaveRegistry.flushAll()

    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
  })

  it("deduplicates concurrent flushAll calls", async () => {
    let resolve!: () => void
    const pending = new Promise<void>((r) => {
      resolve = r
    })
    const flush = vi.fn(async () => {
      await pending
    })
    wikiSaveRegistry.register("/a.md", flush)

    const p1 = wikiSaveRegistry.flushAll()
    const p2 = wikiSaveRegistry.flushAll()
    resolve()
    await Promise.all([p1, p2])

    expect(flush).toHaveBeenCalledOnce()
  })

  it("unregister removes a pending save", async () => {
    const flush = vi.fn(async () => {})
    wikiSaveRegistry.register("/a.md", flush)
    wikiSaveRegistry.unregister("/a.md")

    await wikiSaveRegistry.flushAll()

    expect(flush).not.toHaveBeenCalled()
    expect(wikiSaveRegistry.getPendingCount()).toBe(0)
  })
})
