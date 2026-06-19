import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import { Send } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { InboxComposeToolbar } from "@/components/console/inbox-compose-toolbar"
import { InboxEmojiPopover } from "@/components/console/inbox-emoji-popover"
import {
  InboxComposeRichInput,
  type InboxComposeRichInputHandle,
} from "@/components/console/inbox-compose-rich-input"
import {
  ComposeExpandButton,
  InboxComposeExpandOverlay,
  type InboxComposeExpandOverlayHandle,
} from "@/components/console/inbox-compose-expand-overlay"
import { InboxChatHistoryDialog } from "@/components/wechat/inbox-chat-history-dialog"
import { readChatAgentProxyEnabled } from "@/lib/agent-config-client"
import { sendDriverImage, sendDriverMessage, type DriverChat } from "@/lib/driver-client"
import { isImeComposing } from "@/lib/keyboard-utils"
import { useToastStore } from "@/stores/toast-store"

type InboxComposeBarProps = {
  chat: DriverChat
  agentProxyEnabled: boolean
  agentProxyBusy?: boolean
  onBeforeSend?: (chatId: string, text: string) => string
  onSendFailed?: (chatId: string, clientMsgId: string) => void
  onSent: () => void
  onError?: (message: string) => void
  onJumpToMessage?: (localId: number) => void
}

const READONLY_TEXTAREA_CLASS =
  "min-h-0 w-full flex-1 resize-none border-0 bg-transparent px-3 py-0 text-sm leading-relaxed text-[var(--wx-text)] shadow-none placeholder:text-[var(--wx-muted)] focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:opacity-70"

export function InboxComposeBar({
  chat,
  agentProxyEnabled,
  agentProxyBusy = false,
  onBeforeSend,
  onSendFailed,
  onSent,
  onError,
  onJumpToMessage,
}: InboxComposeBarProps) {
  const chatId = chat.id
  const isGroup = Boolean(chat.isGroup)
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const [draft, setDraft] = useState("")
  const [sending, setSending] = useState(false)
  const [imageSending, setImageSending] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [showExpand, setShowExpand] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const composeInputRef = useRef<InboxComposeRichInputHandle>(null)
  const emojiButtonRef = useRef<HTMLButtonElement>(null)
  const expandOverlayRef = useRef<InboxComposeExpandOverlayHandle>(null)
  const imageFileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setDraft("")
    setSending(false)
    setExpanded(false)
    setHistoryOpen(false)
    setEmojiOpen(false)
  }, [chatId])

  const syncExpandVisibility = useCallback(() => {
    const scrollHeight = composeInputRef.current?.getScrollHeight() ?? 0
    setShowExpand(scrollHeight > 56)
  }, [])

  const canCompose =
    !isGroup && !agentProxyEnabled && !agentProxyBusy && !sending && !imageSending

  const handleDraftChange = useCallback(
    (next: string) => {
      setDraft(next)
      syncExpandVisibility()
    },
    [syncExpandVisibility],
  )

  const insertIntoDraft = useCallback(
    (snippet: string) => {
      if (!canCompose) return
      composeInputRef.current?.insertSnippet(snippet)
      requestAnimationFrame(() => syncExpandVisibility())
    },
    [canCompose, syncExpandVisibility],
  )

  const resolveDraftText = useCallback(() => {
    if (expanded) {
      return expandOverlayRef.current?.getValue() ?? draft
    }
    return draft
  }, [draft, expanded])

  const handleSend = useCallback(async () => {
    const text = resolveDraftText().trim()
    if (!text || sending || isGroup || agentProxyEnabled) return

    setSending(true)
    let clientMsgId: string | undefined
    try {
      clientMsgId = onBeforeSend?.(chatId, text)

      const fileProxy = await readChatAgentProxyEnabled(chatId)
      if (fileProxy) {
        if (clientMsgId) onSendFailed?.(chatId, clientMsgId)
        onError?.(t("wechat.inbox.composeBlockedProxy"))
        return
      }

      const result = await sendDriverMessage({
        chatId,
        text,
        clientMsgId,
      })
      if (!result.success) {
        if (clientMsgId) onSendFailed?.(chatId, clientMsgId)
        onError?.(result.error ?? t("wechat.inbox.composeSendFailed"))
        return
      }

      setDraft("")
      setExpanded(false)
      onSent()
    } catch (err) {
      if (clientMsgId) onSendFailed?.(chatId, clientMsgId)
      onError?.(
        err instanceof Error ? err.message : t("wechat.inbox.composeSendFailed"),
      )
    } finally {
      setSending(false)
    }
  }, [
    agentProxyEnabled,
    chatId,
    isGroup,
    onBeforeSend,
    onError,
    onSendFailed,
    onSent,
    resolveDraftText,
    sending,
    t,
  ])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (isImeComposing(e)) return
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault()
        void handleSend()
      }
    },
    [handleSend],
  )

  const toolbarUnavailable = useCallback(() => {
    addToast(t("wechat.inbox.composeToolbarSoon"), "info")
  }, [addToast, t])

  const historyDialog = onJumpToMessage ? (
    <InboxChatHistoryDialog
      open={historyOpen}
      onOpenChange={setHistoryOpen}
      chat={chat}
      onJumpToMessage={onJumpToMessage}
    />
  ) : null

  const openHistory = useCallback(() => setHistoryOpen(true), [])

  const toggleEmoji = useCallback(() => {
    setEmojiOpen((open) => !open)
  }, [])

  const handleSelectImage = useCallback(() => {
    if (!canCompose) return
    imageFileInputRef.current?.click()
  }, [canCompose])

  const handleImageSelected = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return

      if (file.size > 5 * 1024 * 1024) {
        addToast(t("wechat.inbox.composeImageTooLarge"), "error")
        if (imageFileInputRef.current) {
          imageFileInputRef.current.value = ""
        }
        return
      }

      const allowedTypes = ["image/png", "image/jpeg", "image/gif", "image/webp"]
      if (!allowedTypes.includes(file.type)) {
        addToast(t("wechat.inbox.composeImageFailed"), "error")
        if (imageFileInputRef.current) {
          imageFileInputRef.current.value = ""
        }
        return
      }

      setImageSending(true)
      try {
        const dataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader()
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = () => reject(new Error("Failed to read file"))
          reader.readAsDataURL(file)
        })

        const clientMsgId = onBeforeSend?.(chatId, "")

        const fileProxy = await readChatAgentProxyEnabled(chatId)
        if (fileProxy) {
          if (clientMsgId) onSendFailed?.(chatId, clientMsgId)
          onError?.(t("wechat.inbox.composeBlockedProxy"))
          return
        }

        const result = await sendDriverImage({
          chatId,
          data: dataUrl,
          mimeType: file.type,
          clientMsgId,
        })

        if (!result.success) {
          if (clientMsgId) onSendFailed?.(chatId, clientMsgId)
          onError?.(result.error ?? t("wechat.inbox.composeImageFailed"))
          return
        }

        addToast(t("wechat.inbox.composeImageSent"), "success")
        onSent()
      } catch (err) {
        onError?.(
          err instanceof Error ? err.message : t("wechat.inbox.composeImageFailed"),
        )
      } finally {
        setImageSending(false)
        if (imageFileInputRef.current) {
          imageFileInputRef.current.value = ""
        }
      }
    },
    [addToast, chatId, onBeforeSend, onError, onSendFailed, onSent, t],
  )

  const composeInputRow = (
    canEdit: boolean,
    placeholder: string,
    readOnly = false,
  ) => (
    <div className="flex min-h-0 flex-1 items-stretch">
      <div className="relative flex min-h-0 min-w-0 flex-1">
        {canEdit ? (
          <InboxComposeRichInput
            ref={composeInputRef}
            value={draft}
            onChange={handleDraftChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={!canCompose}
            minRows={2}
          />
        ) : (
          <textarea
            value=""
            readOnly={readOnly}
            disabled
            dir="auto"
            rows={2}
            placeholder={placeholder}
            className={READONLY_TEXTAREA_CLASS}
          />
        )}
        {canEdit && (
          <div className="absolute right-2 top-1">
            <ComposeExpandButton
              visible={showExpand && canCompose}
              onClick={() => setExpanded(true)}
              inline
            />
          </div>
        )}
      </div>
      {canEdit && (
        <div className="flex shrink-0 items-end px-2 pb-1">
          <Button
            type="button"
            size="sm"
            className="h-8 shrink-0 px-2.5"
            disabled={!canCompose || !resolveDraftText().trim()}
            onClick={() => void handleSend()}
          >
            <Send className="mr-1 h-4 w-4" />
            {sending
              ? t("wechat.inbox.composeSending")
              : t("wechat.inbox.composeSend")}
          </Button>
        </div>
      )}
    </div>
  )

  const footerShell = (toolbarDisabled: boolean, body: ReactNode) => (
    <footer className="inbox-compose-footer flex h-full min-h-0 flex-col bg-[var(--wx-header-bg)]">
      <InboxComposeToolbar
        disabled={toolbarDisabled}
        emojiActive={emojiOpen && !toolbarDisabled}
        emojiButtonRef={emojiButtonRef}
        onToggleEmoji={toolbarDisabled ? undefined : toggleEmoji}
        onSelectImage={toolbarDisabled ? undefined : handleSelectImage}
        imageSending={imageSending}
        onUnavailable={toolbarUnavailable}
        onOpenHistory={onJumpToMessage ? openHistory : undefined}
      />
      <InboxEmojiPopover
        open={emojiOpen && !toolbarDisabled}
        anchorRef={emojiButtonRef}
        onInsert={insertIntoDraft}
        onClose={() => setEmojiOpen(false)}
      />
      {body}
      {historyDialog}
    </footer>
  )

  if (isGroup) {
    return footerShell(
      true,
      composeInputRow(
        false,
        t("wechat.inbox.groupReadonlyPlaceholder"),
        true,
      ),
    )
  }

  if (agentProxyEnabled) {
    return footerShell(
      true,
      composeInputRow(
        false,
        t("wechat.inbox.composeDisabledPlaceholder"),
        true,
      ),
    )
  }

  return (
    <>
      {footerShell(
        false,
        composeInputRow(true, t("wechat.inbox.composePlaceholder")),
      )}
      <InboxComposeExpandOverlay
        ref={expandOverlayRef}
        open={expanded}
        value={draft}
        disabled={!canCompose}
        onChange={(next) => {
          setDraft(next)
          syncExpandVisibility()
        }}
        onCommit={(next) => {
          setDraft(next)
          syncExpandVisibility()
        }}
        onClose={() => setExpanded(false)}
      />
      <input
        ref={imageFileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        className="hidden"
        onChange={(e) => {
          void handleImageSelected(e)
        }}
      />
    </>
  )
}
