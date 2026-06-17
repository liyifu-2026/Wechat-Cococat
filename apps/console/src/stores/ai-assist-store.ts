import { create } from "zustand"
import type { MessageReference } from "@/stores/chat-store"
import {
  AI_ASSIST_SLICE_LRU_MAX,
  LruChatSliceCache,
} from "@/lib/lru-chat-slice-cache"

export type AiAssistPanelLayer = "closed" | "open"
export type AiAssistMode = "assist" | "search"

export type AiAssistExpand =
  | {
      kind: "wiki"
      path: string
      title?: string
      projectPath?: string
      relPath?: string
      projectName?: string
    }
  | { kind: "citation"; path: string; title?: string; projectPath?: string; relPath?: string; projectName?: string }

export type AiAssistMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: number
  references?: MessageReference[]
}

export type ChatAiAssistSlice = {
  messages: AiAssistMessage[]
  assistDraft: string
  searchQuery: string
  submittedSearch: string
  lastMode: AiAssistMode
}

let messageCounter = 0

function nextId(): string {
  messageCounter += 1
  return String(messageCounter)
}

const sliceCache = new LruChatSliceCache<ChatAiAssistSlice>(
  AI_ASSIST_SLICE_LRU_MAX,
)

export function emptyChatAiAssistSlice(
  lastMode: AiAssistMode = "assist",
): ChatAiAssistSlice {
  return {
    messages: [],
    assistDraft: "",
    searchQuery: "",
    submittedSearch: "",
    lastMode,
  }
}

function snapshotActiveSlice(state: {
  messages: AiAssistMessage[]
  assistDraft: string
  searchQuery: string
  submittedSearch: string
  lastMode: AiAssistMode
}): ChatAiAssistSlice {
  return {
    messages: state.messages,
    assistDraft: state.assistDraft,
    searchQuery: state.searchQuery,
    submittedSearch: state.submittedSearch,
    lastMode: state.lastMode,
  }
}

function sliceToActiveState(slice: ChatAiAssistSlice): Pick<
  AiAssistState,
  | "messages"
  | "assistDraft"
  | "searchQuery"
  | "submittedSearch"
  | "mode"
  | "lastMode"
> {
  return {
    messages: slice.messages,
    assistDraft: slice.assistDraft,
    searchQuery: slice.searchQuery,
    submittedSearch: slice.submittedSearch,
    lastMode: slice.lastMode,
    mode: slice.lastMode,
  }
}

function persistSliceForChat(chatId: string): void {
  const state = useAiAssistStore.getState()
  sliceCache.set(chatId, snapshotActiveSlice(state))
}

function loadSliceForChat(chatId: string): Pick<
  AiAssistState,
  | "messages"
  | "assistDraft"
  | "searchQuery"
  | "submittedSearch"
  | "mode"
  | "lastMode"
> {
  const slice =
    sliceCache.get(chatId) ?? emptyChatAiAssistSlice(useAiAssistStore.getState().lastMode)
  return sliceToActiveState(slice)
}

/** Test-only: reset LRU between unit tests. */
export function __resetAiAssistSliceCacheForTesting(): void {
  sliceCache.clear()
}

interface AiAssistState {
  layer: AiAssistPanelLayer
  mode: AiAssistMode
  lastMode: AiAssistMode
  assistDraft: string
  searchQuery: string
  submittedSearch: string
  expandStack: AiAssistExpand[]
  expandIndex: number
  boundInboxChatId: string | null
  messages: AiAssistMessage[]
  isStreaming: boolean
  streamingContent: string
  abortRef: AbortController | null

  togglePanel: () => void
  openPanel: () => void
  close: () => void
  setMode: (mode: AiAssistMode) => void
  setAssistDraft: (draft: string) => void
  setSearchQuery: (query: string) => void
  setSubmittedSearch: (query: string) => void
  openExpand: (expand: AiAssistExpand) => void
  closeExpand: () => void
  expandBack: () => void
  expandForward: () => void
  resetSession: () => void
  onInboxChatChanged: (chatId: string | null) => void
  addMessage: (role: AiAssistMessage["role"], content: string) => void
  setStreaming: (streaming: boolean) => void
  appendStreamToken: (token: string) => void
  finalizeStream: (content: string, references?: MessageReference[]) => void
  removeLastAssistantMessage: () => void
  setAbortRef: (controller: AbortController | null) => void
  abortInflight: () => void
  disposePanel: () => void
}

export const useAiAssistStore = create<AiAssistState>((set, get) => ({
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

  togglePanel: () => {
    const { layer } = get()
    if (layer === "closed") {
      const { lastMode } = get()
      set({ layer: "open", mode: lastMode, expandStack: [], expandIndex: -1 })
      return
    }
    get().abortInflight()
    set({ layer: "closed", expandStack: [], expandIndex: -1 })
  },

  openPanel: () => {
    const { lastMode } = get()
    set({ layer: "open", mode: lastMode, expandStack: [], expandIndex: -1 })
  },

  close: () => {
    get().abortInflight()
    set({ layer: "closed", expandStack: [], expandIndex: -1 })
  },

  setMode: (mode) => {
    set({ mode, lastMode: mode })
  },

  setAssistDraft: (assistDraft) => set({ assistDraft }),

  setSearchQuery: (searchQuery) => set({ searchQuery }),

  setSubmittedSearch: (submittedSearch) => set({ submittedSearch }),

  openExpand: (expand) =>
    set((s) => {
      const truncated =
        s.expandIndex >= 0 ? s.expandStack.slice(0, s.expandIndex + 1) : []
      const nextStack = [...truncated, expand]
      return { expandStack: nextStack, expandIndex: nextStack.length - 1 }
    }),

  closeExpand: () => set({ expandStack: [], expandIndex: -1 }),

  expandBack: () =>
    set((s) => {
      if (s.expandIndex <= 0) {
        return { expandStack: [], expandIndex: -1 }
      }
      return { expandIndex: s.expandIndex - 1 }
    }),

  expandForward: () =>
    set((s) => ({
      expandIndex: Math.min(s.expandIndex + 1, s.expandStack.length - 1),
    })),

  resetSession: () => {
    get().abortInflight()
    set({
      messages: [],
      isStreaming: false,
      streamingContent: "",
      abortRef: null,
      assistDraft: "",
    })
  },

  onInboxChatChanged: (chatId) => {
    const prev = get().boundInboxChatId
    if (prev === chatId) return

    get().abortInflight()

    if (prev != null) {
      persistSliceForChat(prev)
    }

    if (chatId == null) {
      const empty = emptyChatAiAssistSlice(get().lastMode)
      set({
        boundInboxChatId: null,
        layer: "closed",
        expandStack: [],
        expandIndex: -1,
        ...sliceToActiveState(empty),
        isStreaming: false,
        streamingContent: "",
        abortRef: null,
      })
      return
    }

    set({
      boundInboxChatId: chatId,
      expandStack: [],
      expandIndex: -1,
      ...loadSliceForChat(chatId),
      isStreaming: false,
      streamingContent: "",
      abortRef: null,
    })
  },

  addMessage: (role, content) => {
    set((s) => ({
      messages: [
        ...s.messages,
        {
          id: nextId(),
          role,
          content,
          timestamp: Date.now(),
        },
      ],
    }))
  },

  setStreaming: (isStreaming) =>
    set({
      isStreaming,
      streamingContent: isStreaming ? "" : get().streamingContent,
    }),

  appendStreamToken: (token) =>
    set((s) => ({ streamingContent: s.streamingContent + token })),

  finalizeStream: (content, references) => {
    set((s) => ({
      isStreaming: false,
      streamingContent: "",
      messages: [
        ...s.messages,
        {
          id: nextId(),
          role: "assistant",
          content,
          timestamp: Date.now(),
          references,
        },
      ],
    }))
  },

  removeLastAssistantMessage: () => {
    set((s) => {
      const idx = [...s.messages]
        .map((m, i) => ({ m, i }))
        .reverse()
        .find(({ m }) => m.role === "assistant")?.i
      if (idx == null) return s
      return { messages: s.messages.filter((_, i) => i !== idx) }
    })
  },

  setAbortRef: (abortRef) => set({ abortRef }),

  abortInflight: () => {
    get().abortRef?.abort()
    set({
      abortRef: null,
      isStreaming: false,
      streamingContent: "",
    })
  },

  disposePanel: () => {
    get().abortInflight()
  },
}))

export function aiAssistMessagesToLLM(
  messages: AiAssistMessage[],
): { role: "user" | "assistant"; content: string }[] {
  return messages
    .filter((m) => m.role === "user" || m.role === "assistant")
    .map((m) => ({ role: m.role, content: m.content }))
}

export function isAiAssistPanelOpen(layer: AiAssistPanelLayer): boolean {
  return layer === "open"
}

export function selectAiAssistExpand(
  state: Pick<AiAssistState, "expandStack" | "expandIndex">,
): AiAssistExpand | null {
  if (state.expandIndex < 0) return null
  return state.expandStack[state.expandIndex] ?? null
}

export function hasAiAssistExpand(
  state: Pick<AiAssistState, "expandStack" | "expandIndex">,
): boolean {
  return selectAiAssistExpand(state) != null
}
