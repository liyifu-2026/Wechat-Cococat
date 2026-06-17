import { describe, expect, it } from "vitest"
import type { DriverMessage } from "@/lib/driver-types"
import { MSG_TYPE_REVOKE } from "@/lib/inbox-system-message"
import {
  buildInboxMessageRows,
  formatMessageDayDivider,
  shouldInsertTimeDivider,
} from "@/lib/inbox-message-time-divider"

function msg(timestamp: string, localId: number): DriverMessage {
  return {
    localId,
    type: 1,
    timestamp,
    content: "hi",
    isSelf: false,
  }
}

describe("inbox-message-time-divider", () => {
  it("formats today as time only in zh-CN", () => {
    const now = new Date("2026-06-16T12:00:00+08:00")
    const label = formatMessageDayDivider(
      "2026-06-16T14:30:00+08:00",
      "zh-CN",
      now,
    )
    expect(label).toBe("14:30")
    expect(label).not.toMatch(/星期/)
  })

  it("formats non-today with weekday in zh-CN", () => {
    const now = new Date("2026-06-17T12:00:00+08:00")
    const label = formatMessageDayDivider(
      "2026-06-16T14:30:00+08:00",
      "zh-CN",
      now,
    )
    expect(label).toMatch(/14:30/)
    expect(label).toMatch(/星期/)
  })

  it("inserts divider on cross-day gap", () => {
    const older = msg("2026-06-15T23:00:00+08:00", 1)
    const newer = msg("2026-06-16T08:00:00+08:00", 2)
    expect(shouldInsertTimeDivider(older, newer)).toBe(true)
  })

  it("inserts divider when gap exceeds threshold", () => {
    const older = msg("2026-06-16T08:00:00+08:00", 1)
    const newer = msg("2026-06-16T08:10:00+08:00", 2)
    expect(shouldInsertTimeDivider(older, newer)).toBe(true)
  })

  it("builds rows with divider before newer message", () => {
    const rows = buildInboxMessageRows([
      msg("2026-06-16T08:00:00+08:00", 1),
      msg("2026-06-16T09:00:00+08:00", 2),
    ])
    expect(rows).toHaveLength(3)
    expect(rows[0]?.kind).toBe("message")
    expect(rows[1]?.kind).toBe("divider")
    expect(rows[2]?.kind).toBe("message")
  })

  it("builds system row for revoke messages", () => {
    const rows = buildInboxMessageRows([
      {
        localId: 9,
        type: MSG_TYPE_REVOKE,
        timestamp: "2026-06-16T08:00:00+08:00",
        content: "Leaif 撤回了一条消息",
        isSelf: false,
      },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.kind).toBe("system")
    if (rows[0]?.kind === "system") {
      expect(rows[0].label).toBe("Leaif 撤回了一条消息")
    }
  })
})
