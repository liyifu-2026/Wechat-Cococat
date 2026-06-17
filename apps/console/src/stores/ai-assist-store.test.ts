import { describe, expect, it, beforeEach } from "vitest"
import {
  __resetAiAssistSliceCacheForTesting,
  selectAiAssistExpand,
  useAiAssistStore,
} from "@/stores/ai-assist-store"
import { AI_ASSIST_SLICE_LRU_MAX } from "@/lib/lru-chat-slice-cache"

describe("useAiAssistStore", () => {
  beforeEach(() => {
    __resetAiAssistSliceCacheForTesting()
    useAiAssistStore.setState({
      layer: "closed",
      mode: "assist",
      lastMode: "assist",
      assistDraft: "",
      searchQuery: "",
      submittedSearch: "",
      expandStack: [],
      expandIndex: -1,
      boundInboxChatId: null,
      messages: [],
      isStreaming: false,
      streamingContent: "",
      abortRef: null,
    })
  })

  it("togglePanel opens with lastMode and closes cleanly", () => {
    useAiAssistStore.getState().setMode("search")
    useAiAssistStore.getState().togglePanel()
    expect(useAiAssistStore.getState().layer).toBe("open")
    expect(useAiAssistStore.getState().mode).toBe("search")

    useAiAssistStore.getState().togglePanel()
    expect(useAiAssistStore.getState().layer).toBe("closed")
  })

  it("setMode preserves drafts", () => {
    useAiAssistStore.getState().setAssistDraft("hello")
    useAiAssistStore.getState().setSearchQuery("wiki term")
    useAiAssistStore.getState().setMode("search")
    expect(useAiAssistStore.getState().assistDraft).toBe("hello")
    expect(useAiAssistStore.getState().searchQuery).toBe("wiki term")
    expect(useAiAssistStore.getState().lastMode).toBe("search")
  })

  it("restores per-chat slice when switching back", () => {
    useAiAssistStore.getState().onInboxChatChanged("chat-a")
    useAiAssistStore.getState().addMessage("user", "hi a")
    useAiAssistStore.getState().setSearchQuery("refund-a")
    useAiAssistStore.getState().setSubmittedSearch("refund-a")

    useAiAssistStore.getState().onInboxChatChanged("chat-b")
    useAiAssistStore.getState().setSearchQuery("other-b")
    expect(useAiAssistStore.getState().messages).toHaveLength(0)

    useAiAssistStore.getState().onInboxChatChanged("chat-a")
    expect(useAiAssistStore.getState().messages).toHaveLength(1)
    expect(useAiAssistStore.getState().messages[0]?.content).toBe("hi a")
    expect(useAiAssistStore.getState().searchQuery).toBe("refund-a")
    expect(useAiAssistStore.getState().submittedSearch).toBe("refund-a")
  })

  it("closes expand when switching chats", () => {
    useAiAssistStore.getState().onInboxChatChanged("chat-a")
    useAiAssistStore.getState().openExpand({ kind: "wiki", path: "/x.md" })
    useAiAssistStore.getState().onInboxChatChanged("chat-b")
    expect(
      selectAiAssistExpand(useAiAssistStore.getState()),
    ).toBeNull()
  })

  it("evicts oldest chat slice when LRU capacity exceeded", () => {
    for (let i = 0; i < AI_ASSIST_SLICE_LRU_MAX; i++) {
      const id = `chat-${i}`
      useAiAssistStore.getState().onInboxChatChanged(id)
      useAiAssistStore.getState().setAssistDraft(`draft-${i}`)
      if (i < AI_ASSIST_SLICE_LRU_MAX - 1) {
        useAiAssistStore.getState().onInboxChatChanged(`chat-${i + 1}`)
      }
    }

    useAiAssistStore.getState().onInboxChatChanged("chat-evict-test")
    useAiAssistStore.getState().setAssistDraft("new")

    useAiAssistStore.getState().onInboxChatChanged("chat-0")
    expect(useAiAssistStore.getState().assistDraft).toBe("")
  })

  it("resetSession clears assist messages and draft only", () => {
    useAiAssistStore.getState().onInboxChatChanged("chat-a")
    useAiAssistStore.getState().addMessage("user", "hi")
    useAiAssistStore.getState().setAssistDraft("draft")
    useAiAssistStore.getState().setSearchQuery("q")
    useAiAssistStore.getState().resetSession()
    expect(useAiAssistStore.getState().messages).toHaveLength(0)
    expect(useAiAssistStore.getState().assistDraft).toBe("")
    expect(useAiAssistStore.getState().searchQuery).toBe("q")
  })
})
