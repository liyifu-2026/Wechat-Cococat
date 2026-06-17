import { describe, expect, it } from "vitest"
import {
  mergeUniqueMessagesDesc,
  messageUnix,
  newestMessageUnix,
  oldestMessageUnix,
} from "@/lib/inbox-message-window"
import type { DriverMessage } from "@/lib/driver-client"

function msg(localId: number, iso: string): DriverMessage {
  return {
    localId,
    type: 1,
    timestamp: iso,
    content: `m${localId}`,
    isSelf: false,
  }
}

describe("inbox-message-window", () => {
  it("messageUnix parses ISO timestamps to seconds", () => {
    expect(messageUnix(msg(1, "2024-01-01T00:00:00.000Z"))).toBe(1704067200)
  })

  it("oldest/newest pick extremes", () => {
    const messages = [
      msg(1, "2024-01-03T00:00:00.000Z"),
      msg(2, "2024-01-01T00:00:00.000Z"),
      msg(3, "2024-01-02T00:00:00.000Z"),
    ]
    expect(oldestMessageUnix(messages)).toBe(1704067200)
    expect(newestMessageUnix(messages)).toBe(1704240000)
  })

  it("mergeUniqueMessagesDesc dedupes and sorts desc", () => {
    const a = [msg(2, "2024-01-02T00:00:00.000Z"), msg(1, "2024-01-01T00:00:00.000Z")]
    const b = [msg(3, "2024-01-03T00:00:00.000Z"), msg(2, "2024-01-02T00:00:00.000Z")]
    const merged = mergeUniqueMessagesDesc(a, b)
    expect(merged.map((m) => m.localId)).toEqual([3, 2, 1])
  })
})
