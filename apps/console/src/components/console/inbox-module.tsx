import { useEffect } from "react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import { InboxChatShell } from "@/components/console/inbox-chat-shell"
import { useDriverInbox } from "@/hooks/use-driver-inbox"
import { useDriverEvents } from "@/hooks/use-driver-events"
import { useAgentProxy } from "@/hooks/use-agent-proxy"
import { useInboxMutes } from "@/hooks/use-inbox-mutes"
import { useInboxSessionContext } from "@/hooks/use-inbox-session-context"
import { StatusBadge } from "@/components/console/status-badge"
import {
  refreshStackHealth,
  useStackHealth,
} from "@/hooks/use-stack-health"
import { useConsoleStore } from "@/stores/console-store"
import { useAiAssistStore } from "@/stores/ai-assist-store"
import { useToastStore } from "@/stores/toast-store"
import { useInboxUnreadStore } from "@/stores/inbox-unread-store"
import { runStackOrchestrator } from "@/lib/stack-orchestrator"
import { useComposeHeightVar } from "@/hooks/use-compose-height-var"

type InboxGate =
  | { kind: "loading" }
  | { kind: "driver_down" }
  | { kind: "wechat_db_not_ready" }
  | { kind: "ready" }

function resolveInboxGate(health: ReturnType<typeof useStackHealth>): InboxGate {
  if (health.loading) return { kind: "loading" }
  if (health.driver !== "up") return { kind: "driver_down" }
  if (!health.chatsReady) return { kind: "wechat_db_not_ready" }
  return { kind: "ready" }
}

export function InboxModule() {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const health = useStackHealth()
  const navigateSystemWechat = useConsoleStore((s) => s.navigateSystemWechat)
  const pendingWeChatChatId = useConsoleStore((s) => s.pendingWeChatChatId)
  const consumePendingWeChatChatId = useConsoleStore(
    (s) => s.consumePendingWeChatChatId,
  )

  const gate = resolveInboxGate(health)
  const wechatHealth =
    health.driver !== "up"
      ? health.driver
      : !health.wechatLoggedIn
        ? "degraded"
        : health.chatsReady
          ? "up"
          : "degraded"

  const inbox = useDriverInbox(gate.kind === "ready")
  const chatsLoadFailed =
    gate.kind === "ready" &&
    !inbox.loading &&
    inbox.allChats.length === 0 &&
    health.wechatLoggedIn
  const {
    muteByChatId,
    unmuteChat,
    muteChat,
    markChatDone,
  } = useInboxMutes()

  const { openChatById, selectedChat, messages } = inbox

  useEffect(() => {
    useAiAssistStore.getState().onInboxChatChanged(selectedChat?.id ?? null)
  }, [selectedChat?.id])

  const activeWechatTab = useConsoleStore((s) => s.activeWechatTab)
  useEffect(() => {
    if (activeWechatTab !== "chats") {
      useAiAssistStore.getState().close()
    }
  }, [activeWechatTab])

  useComposeHeightVar(gate.kind === "ready" && !!selectedChat)
  const selectedMute = selectedChat
    ? muteByChatId.get(selectedChat.id) ?? null
    : null
  const session = useInboxSessionContext(
    selectedChat,
    selectedMute,
    messages,
  )
  const agentProxy = useAgentProxy(selectedChat?.id ?? null)

  useDriverEvents({
    enabled: gate.kind === "ready",
    selectedChatId: selectedChat?.id ?? null,
    onChatsChanged: () => {
      void inbox.refreshChats({ silent: true })
    },
    onSelectedChatActivity: (chatId) => {
      void inbox.refreshMessages(chatId)
    },
  })

  useEffect(() => {
    if (gate.kind !== "ready" || !pendingWeChatChatId) return
    const chatId = consumePendingWeChatChatId()
    if (chatId) void openChatById(chatId)
  }, [gate.kind, pendingWeChatChatId, consumePendingWeChatChatId, openChatById])

  async function handleUnmute(chatId: string) {
    try {
      const changed = await unmuteChat(chatId)
      if (changed) {
        addToast(t("wechat.inbox.unmuteSuccess"), "success")
        void session.reload()
      } else {
        addToast(t("wechat.inbox.unmuteNoop"), "info")
      }
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : String(err),
        "error",
      )
    }
  }

  async function handleMarkDone(chatId: string) {
    try {
      const changed = await markChatDone(chatId)
      if (changed) {
        addToast(t("wechat.inbox.markDoneSuccess"), "success")
        void session.reload()
      } else {
        addToast(t("wechat.inbox.unmuteNoop"), "info")
      }
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : String(err),
        "error",
      )
    }
  }

  async function handleMarkTodo(chatId: string, chatName: string) {
    try {
      const changed = await muteChat(chatId, chatName, "escalate_a")
      if (changed) {
        addToast(t("wechat.inbox.contextMarkTodoSuccess"), "success")
        void session.reload()
      }
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : String(err),
        "error",
      )
    }
  }

  async function handleMute(chatId: string, chatName: string) {
    try {
      const changed = await muteChat(chatId, chatName, "manual")
      if (changed) {
        addToast(t("wechat.inbox.contextMuteSuccess"), "success")
        void session.reload()
      }
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : String(err),
        "error",
      )
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-0 flex-1 flex-col">
        {gate.kind !== "ready" ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-10 text-center">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <StatusBadge label="Driver" health={health.driver} />
              <StatusBadge label="WeChat" health={wechatHealth} />
            </div>
            {gate.kind === "loading" ? (
              <p className="text-sm text-muted-foreground">
                {t("wechat.inbox.checkingServices")}
              </p>
            ) : (
              <>
                <p className="max-w-md text-sm text-muted-foreground">
                  {gate.kind === "driver_down" &&
                    t("wechat.inbox.chatsDriverDown")}
                  {gate.kind === "wechat_db_not_ready" &&
                    t("wechat.inbox.chatsDbNotReady")}
                </p>
                <Button
                  size="sm"
                  onClick={() => {
                    if (gate.kind === "driver_down") {
                      void runStackOrchestrator("start", () => {}).then(() =>
                        refreshStackHealth(),
                      )
                    } else {
                      void refreshStackHealth()
                      navigateSystemWechat(true)
                    }
                  }}
                >
                  {gate.kind === "wechat_db_not_ready" &&
                    t("wechat.inbox.syncWechatDb")}
                  {gate.kind === "driver_down" &&
                    t("wechat.inbox.openDriverServices")}
                </Button>
              </>
            )}
          </div>
        ) : (
          <InboxChatShell
            chats={inbox.chats}
            chatsLoading={inbox.loading}
            messageHits={inbox.messageHits}
            messageHitsLoading={inbox.messageHitsLoading}
            selectedChat={inbox.selectedChat}
            messages={inbox.messages}
            messagesLoading={inbox.messagesLoading}
            listQuery={inbox.listQuery}
            onListQueryChange={inbox.setListQuery}
            onSelectChat={(c) => void inbox.selectChat(c)}
            onJumpToMessage={(chat, localId) =>
              void inbox.jumpToMessage(chat, localId)
            }
            onReturnToLatest={() => void inbox.returnToLatest()}
            pendingScrollLocalId={inbox.pendingScrollLocalId}
            scrollRestoreTop={inbox.scrollRestoreTop}
            onCaptureScrollMemory={inbox.captureScrollMemory}
            onScrollRestoreApplied={inbox.clearScrollRestore}
            onClearPendingScroll={inbox.clearPendingScroll}
            messageViewMode={inbox.messageViewMode}
            loadingNewer={inbox.loadingNewer}
            hasMoreNewer={inbox.hasMoreNewer}
            onLoadNewerMessages={inbox.loadNewerMessages}
            muteByChatId={muteByChatId}
            onUnmuteChat={(id) => void handleUnmute(id)}
            onMarkChatDone={(id) => void handleMarkDone(id)}
            onMarkTodoChat={(id, name) => void handleMarkTodo(id, name)}
            onMuteChat={(id, name) => void handleMute(id, name)}
            onMarkChatRead={(id) => useInboxUnreadStore.getState().markChatAsRead(id)}
            onMarkChatUnread={(id) => useInboxUnreadStore.getState().markChatAsUnread(id)}
            agentProxy={agentProxy}
            onRefreshMessages={(chatId) => void inbox.onMessageSent(chatId)}
            onBeforeSend={(chatId, text) => inbox.appendOptimisticSend(chatId, text)}
            onSendFailed={(chatId, clientMsgId) =>
              inbox.revertOptimisticSend(chatId, clientMsgId)
            }
            loadingOlder={inbox.loadingOlder}
            hasMoreOlder={inbox.hasMoreOlder}
            onLoadOlderMessages={inbox.loadOlderMessages}
            onComposeError={(msg) => addToast(msg, "error")}
            emptyListHint={
              chatsLoadFailed ? t("wechat.inbox.chatsDbNotReady") : undefined
            }
            onEmptyListAction={
              chatsLoadFailed
                ? () => {
                    void refreshStackHealth()
                    navigateSystemWechat(true)
                  }
                : undefined
            }
            emptyListActionLabel={
              chatsLoadFailed ? t("wechat.inbox.syncWechatDb") : undefined
            }
          />
        )}
        {inbox.error && (
          <p className="px-4 py-2 text-sm text-destructive">{inbox.error}</p>
        )}
      </div>
    </div>
  )
}
