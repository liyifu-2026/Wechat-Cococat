import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { ChatMessage, StreamingMessage } from "@/components/chat/chat-message"
import { useInboxAiAssistSend } from "@/hooks/use-inbox-ai-assist-send"
import { useAiAssistStore } from "@/stores/ai-assist-store"

import type { WikiReferenceOpenMeta } from "@/lib/wiki-reference-path"

type InboxAiAssistChatProps = {
  onOpenReference?: (
    path: string,
    title?: string,
    meta?: WikiReferenceOpenMeta,
  ) => void
  wikiProjectPaths?: string[]
  wikiBlocked?: boolean
  wikiLoading?: boolean
}

export function InboxAiAssistChat({
  onOpenReference,
  wikiProjectPaths,
  wikiBlocked = false,
  wikiLoading = false,
}: InboxAiAssistChatProps) {
  const { t } = useTranslation()
  const messages = useAiAssistStore((s) => s.messages)
  const isStreaming = useAiAssistStore((s) => s.isStreaming)
  const streamingContent = useAiAssistStore((s) => s.streamingContent)
  const { handleRegenerate } = useInboxAiAssistSend()

  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, streamingContent])

  return (
    <div
      ref={scrollRef}
      className="inbox-ai-content-fade min-h-0 flex-1 overflow-y-auto px-3 py-2"
    >
      {wikiLoading ? (
        <p className="py-8 text-center text-sm text-[var(--wx-muted)]">
          {t("wechat.aiAssist.wikiLoading")}
        </p>
      ) : wikiBlocked ? null : messages.length === 0 && !isStreaming ? null : (
        <div className="flex flex-col gap-3">
          {messages.map((msg, idx) => {
            const isLastAssistant =
              msg.role === "assistant" &&
              !messages.slice(idx + 1).some((m) => m.role === "assistant")
            return (
              <ChatMessage
                key={msg.id}
                variant="inbox-ai"
                wikiProjectPaths={wikiProjectPaths}
                message={{
                  ...msg,
                  conversationId: "ai-assist",
                }}
                isLastAssistant={isLastAssistant && !isStreaming}
                onRegenerate={
                  isLastAssistant ? handleRegenerate : undefined
                }
                onOpenReference={onOpenReference}
              />
            )
          })}
          {isStreaming && (
            <StreamingMessage
              variant="inbox-ai"
              wikiProjectPaths={wikiProjectPaths}
              content={streamingContent}
              onOpenReference={onOpenReference}
            />
          )}
        </div>
      )}
    </div>
  )
}
