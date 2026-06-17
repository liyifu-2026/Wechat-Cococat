import { describe, expect, it } from "vitest"
import {
  isWeChatMediaXml,
  messageDisplayBody,
} from "@/lib/wechat-message-body"

const t = (key: string) => key

describe("isWeChatMediaXml", () => {
  it("detects voicemsg XML", () => {
    expect(
      isWeChatMediaXml(
        '<msg><voicemsg endflag="1" voicelength="2699" /></msg>',
      ),
    ).toBe(true)
  })

  it("allows plain text", () => {
    expect(isWeChatMediaXml("你好")).toBe(false)
  })
})

describe("messageDisplayBody", () => {
  it("hides voice XML and returns placeholder", () => {
    expect(
      messageDisplayBody(
        {
          content: '<msg><voicemsg endflag="1" /></msg>',
          mediaKind: "voice",
          type: 34,
        },
        t,
      ),
    ).toBe("wechat.inbox.mediaVoice")
  })

  it("returns plain text unchanged", () => {
    expect(
      messageDisplayBody({ content: "hello", mediaKind: undefined, type: 1 }, t),
    ).toBe("hello")
  })
})
