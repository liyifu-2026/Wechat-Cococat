import { useCallback } from "react"
import { streamChat } from "@/lib/llm-client"
import { buildWikiAssistContext } from "@/lib/wiki-assist"
import { useAllWikiProjects } from "@/hooks/use-all-wiki-projects"
import {
  aiAssistMessagesToLLM,
  useAiAssistStore,
} from "@/stores/ai-assist-store"
import { useWikiStore } from "@/stores/wiki-store"
import type { ChatSendOptions } from "@/components/chat/chat-input"

export function useInboxAiAssistSend() {
  const wiki = useAllWikiProjects()
  const llmConfig = useWikiStore((s) => s.llmConfig)
  const searchApiConfig = useWikiStore((s) => s.searchApiConfig)
  const isStreaming = useAiAssistStore((s) => s.isStreaming)
  const addMessage = useAiAssistStore((s) => s.addMessage)
  const setStreaming = useAiAssistStore((s) => s.setStreaming)
  const appendStreamToken = useAiAssistStore((s) => s.appendStreamToken)
  const finalizeStream = useAiAssistStore((s) => s.finalizeStream)
  const removeLastAssistantMessage = useAiAssistStore(
    (s) => s.removeLastAssistantMessage,
  )
  const setAbortRef = useAiAssistStore((s) => s.setAbortRef)

  const resolvedProjects = wiki.resolved
  const hasWiki = resolvedProjects.length > 0 && !wiki.loading

  const handleSend = useCallback(
    async (text: string, options: ChatSendOptions) => {
      if (!hasWiki || !text.trim()) return

      addMessage("user", text.trim())
      setStreaming(true)

      const { systemMessages, queryRefs, langReminder } =
        await buildWikiAssistContext(
          resolvedProjects.map((p) => ({
            projectPath: p.projectPath,
            projectName: p.name || p.alias,
          })),
          text.trim(),
          llmConfig,
          searchApiConfig,
          options,
        )

      const prior = useAiAssistStore
        .getState()
        .messages.filter((m) => m.role === "user" || m.role === "assistant")
        .slice(0, -1)
        .slice(-20)

      let llmMessages = [
        ...systemMessages,
        ...aiAssistMessagesToLLM(prior),
        { role: "user" as const, content: text.trim() },
      ]

      if (langReminder) {
        const lastIdx = llmMessages.length - 1
        const last = llmMessages[lastIdx]
        if (last?.role === "user") {
          llmMessages = [
            ...llmMessages.slice(0, lastIdx),
            {
              role: "user" as const,
              content: `[${langReminder}]\n\n${last.content}`,
            },
          ]
        }
      }

      const controller = new AbortController()
      setAbortRef(controller)

      let accumulated = ""
      let thinkingOpen = false

      const appendReasoning = (token: string) => {
        if (!token) return
        if (!thinkingOpen) {
          thinkingOpen = true
          accumulated += "<think>"
          appendStreamToken("<think>")
        }
        accumulated += token
        appendStreamToken(token)
      }

      const closeReasoning = () => {
        if (!thinkingOpen) return
        thinkingOpen = false
        accumulated += "</think>"
        appendStreamToken("</think>")
      }

      await streamChat(
        llmConfig,
        llmMessages,
        {
          onToken: (token) => {
            closeReasoning()
            accumulated += token
            appendStreamToken(token)
          },
          onReasoningToken: appendReasoning,
          onDone: () => {
            closeReasoning()
            finalizeStream(accumulated, queryRefs)
            setAbortRef(null)
          },
          onError: (err) => {
            finalizeStream(`Error: ${err.message}`, undefined)
            setAbortRef(null)
          },
        },
        controller.signal,
      )
    },
    [
      addMessage,
      appendStreamToken,
      finalizeStream,
      hasWiki,
      llmConfig,
      resolvedProjects,
      searchApiConfig,
      setAbortRef,
      setStreaming,
    ],
  )

  const handleStop = useCallback(() => {
    useAiAssistStore.getState().abortInflight()
  }, [])

  const handleRegenerate = useCallback(async () => {
    if (isStreaming) return
    const msgs = useAiAssistStore.getState().messages
    const lastUser = [...msgs].reverse().find((m) => m.role === "user")
    if (!lastUser) return
    removeLastAssistantMessage()
    await new Promise((r) => setTimeout(r, 50))
    useAiAssistStore.setState({
      messages: useAiAssistStore
        .getState()
        .messages.filter((m) => m.id !== lastUser.id),
    })
    await handleSend(lastUser.content, {
      useWebSearch: false,
      useAnyTxtSearch: false,
    })
  }, [handleSend, isStreaming, removeLastAssistantMessage])

  return {
    handleSend,
    handleStop,
    handleRegenerate,
    isStreaming,
    hasWiki,
    wikiLoading: wiki.loading,
  }
}
