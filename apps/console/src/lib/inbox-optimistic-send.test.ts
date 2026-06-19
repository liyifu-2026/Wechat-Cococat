import { describe, expect, it } from "vitest"
import type { DriverMessage } from "@/lib/driver-types"
import {
  applyOptimisticLayer,
  buildOptimisticMessage,
  createClientMsgId,
  optimisticLocalId,
  type OptimisticPending,
} from "@/lib/inbox-optimistic-send"

function serverMsg(
  localId: number,
  content: string,
  clientMsgId?: string,
): DriverMessage {
  return {
    localId,
    type: 1,
    content,
    timestamp: "2026-06-16T10:00:00.000Z",
    isSelf: true,
    clientMsgId,
  }
}

describe("inbox-optimistic-send", () => {
  it("createClientMsgId produces unique client-* ids", () => {
    const a = createClientMsgId()
    const b = createClientMsgId()
    expect(a).toMatch(/^client-/)
    expect(b).toMatch(/^client-/)
    expect(a).not.toBe(b)
  })

  it("optimisticLocalId is stable and negative", () => {
    const id = "client-abc"
    expect(optimisticLocalId(id)).toBe(optimisticLocalId(id))
    expect(optimisticLocalId(id)).toBeLessThan(0)
  })

  it("reconciles by clientMsgId without cross-resolving same content", () => {
    const now = Date.now()
    const pendingA: OptimisticPending = {
      clientMsgId: "client-a",
      chatId: "chat-1",
      text: "hello",
      createdAt: now - 2_000,
    }
    const pendingB: OptimisticPending = {
      clientMsgId: "client-b",
      chatId: "chat-1",
      text: "hello",
      createdAt: now - 1_000,
    }

    const fetched = [serverMsg(100, "hello", "client-a")]
    const { messages, resolvedClientIds } = applyOptimisticLayer(fetched, [
      pendingA,
      pendingB,
    ])

    expect(resolvedClientIds).toEqual(["client-a"])
    expect(messages.some((m) => m.clientMsgId === "client-b" && m.pending)).toBe(
      true,
    )
    expect(messages.some((m) => m.localId === 100 && !m.pending)).toBe(true)
    expect(
      messages.filter((m) => m.content === "hello" && !m.pending),
    ).toHaveLength(1)
  })

  it("reconciles by matching self content when clientMsgId is missing", () => {
    const pending: OptimisticPending = {
      clientMsgId: "client-a",
      chatId: "chat-1",
      text: "hello",
      createdAt: Date.now() - 1_000,
    }
    const fetched = [serverMsg(100, "hello")]
    const { messages, resolvedClientIds } = applyOptimisticLayer(fetched, [
      pending,
    ])

    expect(resolvedClientIds).toEqual(["client-a"])
    expect(messages.some((m) => m.pending)).toBe(false)
    expect(messages.some((m) => m.localId === 100)).toBe(true)
  })

  it("buildOptimisticMessage marks pending self bubble", () => {
    const pending: OptimisticPending = {
      clientMsgId: "client-x",
      chatId: "c1",
      text: "draft",
      createdAt: Date.now(),
    }
    const msg = buildOptimisticMessage(pending)
    expect(msg.pending).toBe(true)
    expect(msg.isSelf).toBe(true)
    expect(msg.clientMsgId).toBe("client-x")
  })
})
