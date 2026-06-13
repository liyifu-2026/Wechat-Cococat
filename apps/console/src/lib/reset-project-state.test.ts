import { describe, it, expect, beforeEach, vi } from "vitest"
import { resetProjectState } from "./reset-project-state"
import { useChatStore } from "@/stores/chat-store"
import { useReviewStore } from "@/stores/review-store"
import { useActivityStore } from "@/stores/activity-store"

import { getQueue, pauseQueue } from "./ingest-queue"
// Dynamic-import mocks: resetProjectState uses `import("@/lib/ingest-queue")`
// at runtime. vi.mock hoists this so the promise resolves to our stub immediately.
vi.mock("./ingest-queue", async () => {
  const actual = await vi.importActual<typeof import("./ingest-queue")>("./ingest-queue")
  return {
    ...actual,
    pauseQueue: vi.fn(async () => {}),
  }
})

const mockPauseQueue = vi.mocked(pauseQueue)

beforeEach(() => {
  mockPauseQueue.mockReset()
  mockPauseQueue.mockImplementation(async () => {})
})

describe("resetProjectState — Zustand stores", () => {
  it("clears chat store conversations and messages", async () => {
    useChatStore.setState({
      conversations: [{ id: "c1", title: "x", createdAt: 0, updatedAt: 0 }],
      messages: [
        { id: "m1", role: "user", content: "hi", timestamp: 0, conversationId: "c1" },
      ],
      activeConversationId: "c1",
      isStreaming: true,
      streamingContent: "partial",
      mode: "ingest",
      ingestSource: "/some/file",
    })

    await resetProjectState()

    const chat = useChatStore.getState()
    expect(chat.conversations).toEqual([])
    expect(chat.messages).toEqual([])
    expect(chat.activeConversationId).toBeNull()
    expect(chat.isStreaming).toBe(false)
    expect(chat.streamingContent).toBe("")
    expect(chat.mode).toBe("chat")
    expect(chat.ingestSource).toBeNull()
  })

  it("clears review store items", async () => {
    useReviewStore.setState({
      items: [
        {
          id: "r1",
          type: "missing-page",
          title: "x",
          description: "",
          options: [],
          resolved: false,
          createdAt: 0,
        },
      ],
    })

    await resetProjectState()
    expect(useReviewStore.getState().items).toEqual([])
  })

  it("clears activity store items", async () => {
    useActivityStore.setState({
      items: [
        {
          id: "a1",
          type: "query",
          title: "t",
          status: "done",
          detail: "",
          filesWritten: [],
          createdAt: 0,
        },
      ],
    })

    await resetProjectState()
    expect(useActivityStore.getState().items).toEqual([])
  })


})

describe("resetProjectState — module-level caches are awaited", () => {
  it("calls pauseQueue before the returned promise resolves", async () => {
    await resetProjectState()
    expect(mockPauseQueue).toHaveBeenCalledOnce()
  })

  it("does not throw when pauseQueue itself throws — logs and continues", async () => {
    mockPauseQueue.mockImplementationOnce(async () => {
      throw new Error("boom")
    })
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    await expect(resetProjectState()).resolves.toBeUndefined()
    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })
})

describe("resetProjectState — leaves unrelated store keys alone", () => {
  it("preserves maxHistoryMessages on chat store (config, not project data)", async () => {
    useChatStore.setState({ maxHistoryMessages: 42 })
    await resetProjectState()
    expect(useChatStore.getState().maxHistoryMessages).toBe(42)
  })
})

// Silence the "unused import" warning on getQueue (kept for potential future tests).
void getQueue
