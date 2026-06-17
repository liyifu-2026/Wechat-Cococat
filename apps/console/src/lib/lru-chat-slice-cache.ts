/** Max in-memory AI assist slices (see M2-console-P1 spec). */
export const AI_ASSIST_SLICE_LRU_MAX = 30

/**
 * LRU cache for per-chat AI assist state. Evicts least-recently-used chat
 * when capacity is exceeded.
 */
export class LruChatSliceCache<T> {
  private readonly map = new Map<string, T>()

  constructor(private readonly maxSize: number) {}

  get size(): number {
    return this.map.size
  }

  get(key: string): T | undefined {
    const value = this.map.get(key)
    if (value === undefined) return undefined
    this.map.delete(key)
    this.map.set(key, value)
    return value
  }

  set(key: string, value: T): void {
    if (this.map.has(key)) {
      this.map.delete(key)
    }
    this.map.set(key, value)
    while (this.map.size > this.maxSize) {
      const oldest = this.map.keys().next().value as string | undefined
      if (oldest === undefined) break
      this.map.delete(oldest)
    }
  }

  delete(key: string): void {
    this.map.delete(key)
  }

  clear(): void {
    this.map.clear()
  }
}
