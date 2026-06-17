import { describe, expect, it } from "vitest"
import {
  isSystemMessage,
  MSG_TYPE_REVOKE,
  systemMessageLabel,
} from "@/lib/inbox-system-message"

describe("inbox-system-message", () => {
  it("detects revoke by type", () => {
    expect(
      isSystemMessage({
        type: MSG_TYPE_REVOKE,
        content: "",
      }),
    ).toBe(true)
  })

  it("detects revoke sysmsg XML", () => {
    expect(
      isSystemMessage({
        type: 1,
        content:
          '<?xml version="1.0"?><sysmsg type="revokemsg"><revokemsg><content>"Leaif" 撤回了一条消息</content></revokemsg></sysmsg>',
      }),
    ).toBe(true)
  })

  it("parses revoke label from XML", () => {
    expect(
      systemMessageLabel({
        type: MSG_TYPE_REVOKE,
        content:
          '<sysmsg type="revokemsg"><revokemsg><content>"Leaif" 撤回了一条消息</content></revokemsg></sysmsg>',
      }),
    ).toBe("Leaif 撤回了一条消息")
  })

  it("uses cleaned plain text from driver", () => {
    expect(
      systemMessageLabel({
        type: MSG_TYPE_REVOKE,
        content: '"Leaif" 撤回了一条消息',
      }),
    ).toBe("Leaif 撤回了一条消息")
  })
})
