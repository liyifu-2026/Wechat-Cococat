import { describe, expect, it } from "vitest"
import { LruChatSliceCache } from "@/lib/lru-chat-slice-cache"

describe("LruChatSliceCache", () => {
  it("stores and retrieves values", () => {
    const cache = new LruChatSliceCache<string>(3)
    cache.set("a", "A")
    expect(cache.get("a")).toBe("A")
  })

  it("evicts least recently used when over capacity", () => {
    const cache = new LruChatSliceCache<string>(2)
    cache.set("a", "A")
    cache.set("b", "B")
    cache.get("a")
    cache.set("c", "C")
    expect(cache.get("b")).toBeUndefined()
    expect(cache.get("a")).toBe("A")
    expect(cache.get("c")).toBe("C")
  })

  it("updates existing key without spurious eviction", () => {
    const cache = new LruChatSliceCache<number>(2)
    cache.set("a", 1)
    cache.set("b", 2)
    cache.set("a", 10)
    expect(cache.size).toBe(2)
    expect(cache.get("a")).toBe(10)
    expect(cache.get("b")).toBe(2)
  })
})
