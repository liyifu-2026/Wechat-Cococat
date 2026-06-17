import { describe, expect, it } from "vitest"
import {
  contactKeysFromChats,
  contactKeysFromMessages,
} from "@/lib/contact-cache-keys"

describe("contactKeysFromChats", () => {
  it("collects username and id", () => {
    expect(
      contactKeysFromChats([
        { id: "wxid_a", username: "wxid_a" },
        { id: "room@chatroom", username: "room@chatroom", isGroup: true },
      ]),
    ).toEqual(["wxid_a", "room@chatroom"])
  })

  it("dedupes when id differs from username", () => {
    const keys = contactKeysFromChats([
      { id: "chat-1", username: "wxid_b" },
    ])
    expect(keys.sort()).toEqual(["chat-1", "wxid_b"].sort())
  })
})

describe("contactKeysFromMessages", () => {
  it("merges extras and senders", () => {
    expect(
      contactKeysFromMessages(
        [{ sender: "wxid_c" }, { sender: "wxid_c" }],
        ["wxid_self"],
      ).sort(),
    ).toEqual(["wxid_c", "wxid_self"].sort())
  })
})
