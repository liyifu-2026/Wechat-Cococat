import { useEffect, useState } from "react"
import { RefreshCw } from "lucide-react"
import { useTranslation } from "react-i18next"
import { Button } from "@/components/ui/button"
import {
  InboxChatShell,
  type InboxListFilter,
} from "@/components/console/inbox-chat-shell"
import { useDriverInbox } from "@/hooks/use-driver-inbox"
import { useInboxMutes } from "@/hooks/use-inbox-mutes"
import { useInboxSessionContext } from "@/hooks/use-inbox-session-context"
import { StatusBadge } from "@/components/console/status-badge"
import {
  refreshStackHealth,
  useStackHealth,
} from "@/hooks/use-stack-health"
import { useConsoleStore } from "@/stores/console-store"
import { useToastStore } from "@/stores/toast-store"

type InboxGate =
  | { kind: "loading" }
  | { kind: "driver_down" }
  | { kind: "driver_unreachable" }
  | { kind: "wechat_not_logged_in" }
  | { kind: "wechat_db_not_ready" }
  | { kind: "ready" }

function resolveInboxGate(health: ReturnType<typeof useStackHealth>): InboxGate {
  if (health.loading) return { kind: "loading" }
  if (health.driver === "down") return { kind: "driver_down" }
  if (health.driver === "degraded" || health.driver === "unknown") {
    return { kind: "driver_unreachable" }
  }
  if (!health.wechatLoggedIn) return { kind: "wechat_not_logged_in" }
  if (!health.chatsReady) return { kind: "wechat_db_not_ready" }
  return { kind: "ready" }
}

export function InboxModule() {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const health = useStackHealth()
  const navigateSystem = useConsoleStore((s) => s.navigateSystem)
  const navigateSystemWechat = useConsoleStore((s) => s.navigateSystemWechat)
  const consumePendingWeChatChatId = useConsoleStore(
    (s) => s.consumePendingWeChatChatId,
  )
  const consumePendingInboxFilter = useConsoleStore(
    (s) => s.consumePendingInboxFilter,
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
    mutes,
    muteByChatId,
    busyChatId,
    batchBusy,
    refreshMutes,
    unmuteChat,
    markChatDone,
    markAllDone,
  } = useInboxMutes()
  const pendingFilter = consumePendingInboxFilter()
  const [listFilter, setListFilter] = useState<InboxListFilter>(
    pendingFilter ?? "all",
  )

  useEffect(() => {
    if (pendingFilter) setListFilter(pendingFilter)
  }, [pendingFilter])

  const { chats, selectChatById, selectedChat, messages } = inbox
  const selectedMute = selectedChat
    ? muteByChatId.get(selectedChat.id) ?? null
    : null
  const session = useInboxSessionContext(
    selectedChat,
    selectedMute,
    messages,
  )

  useEffect(() => {
    if (chats.length === 0) return
    const chatId = consumePendingWeChatChatId()
    if (chatId) selectChatById(chatId)
  }, [chats, consumePendingWeChatChatId, selectChatById])

  const handleRefresh = () => {
    void inbox.refreshChats()
    void refreshMutes()
    if (inbox.selectedChat) {
      void inbox.refreshMessages(inbox.selectedChat.id)
    }
  }

  async function handleUnmute(chatId: string) {
    try {
      const changed = await unmuteChat(chatId)
      if (changed) {
        addToast(t("console.inbox.unmuteSuccess"), "success")
        void session.reload()
      } else {
        addToast(t("console.inbox.unmuteNoop"), "info")
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
        addToast(t("console.inbox.markDoneSuccess"), "success")
        void session.reload()
      } else {
        addToast(t("console.inbox.unmuteNoop"), "info")
      }
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : String(err),
        "error",
      )
    }
  }

  async function handleMarkAllDone() {
    if (mutes.length === 0) return
    try {
      const count = await markAllDone()
      addToast(
        t("console.inbox.markAllDoneSuccess", { count }),
        count > 0 ? "success" : "info",
      )
    } catch (err) {
      addToast(
        err instanceof Error ? err.message : String(err),
        "error",
      )
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-6 pb-3 pt-6">
        <div>
          <h1 className="text-xl font-semibold">{t("console.inbox.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("console.inbox.subtitle")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {mutes.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              disabled={batchBusy}
              onClick={() => void handleMarkAllDone()}
            >
              {t("console.inbox.markAllDone")}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={inbox.loading || batchBusy}
          >
            <RefreshCw
              className={`mr-2 h-4 w-4 ${inbox.loading ? "animate-spin" : ""}`}
            />
            {t("console.refresh")}
          </Button>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-6 pb-4">
        {gate.kind !== "ready" ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-md border bg-muted/20 px-6 py-10 text-center">
            <div className="flex flex-wrap items-center justify-center gap-2">
              <StatusBadge label="Driver" health={health.driver} />
              <StatusBadge label="WeChat" health={wechatHealth} />
            </div>
            {gate.kind === "loading" ? (
              <p className="text-sm text-muted-foreground">
                {t("console.inbox.checkingServices")}
              </p>
            ) : (
              <>
                <p className="max-w-md text-sm text-muted-foreground">
                  {gate.kind === "driver_down" &&
                    t("console.inbox.chatsDriverDown")}
                  {gate.kind === "driver_unreachable" &&
                    t("console.inbox.chatsDriverUnreachable")}
                  {gate.kind === "wechat_not_logged_in" &&
                    t("console.inbox.chatsWechatNotLoggedIn")}
                  {gate.kind === "wechat_db_not_ready" &&
                    t("console.inbox.chatsDbNotReady")}
                </p>
                <Button
                  size="sm"
                  onClick={() => {
                    if (
                      gate.kind === "driver_down" ||
                      gate.kind === "driver_unreachable"
                    ) {
                      navigateSystem("services", "driver")
                    } else if (gate.kind === "wechat_db_not_ready") {
                      void refreshStackHealth()
                      navigateSystemWechat(true)
                    } else {
                      navigateSystemWechat()
                    }
                  }}
                >
                  {gate.kind === "wechat_not_logged_in" &&
                    t("console.inbox.openWechatLogin")}
                  {gate.kind === "wechat_db_not_ready" &&
                    t("console.inbox.syncWechatDb")}
                  {(gate.kind === "driver_down" ||
                    gate.kind === "driver_unreachable") &&
                    t("console.inbox.openDriverServices")}
                </Button>
              </>
            )}
          </div>
        ) : (
          <InboxChatShell
            chats={inbox.chats}
            chatsLoading={inbox.loading}
            messageHits={inbox.messageHits}
            selectedChat={inbox.selectedChat}
            messages={inbox.messages}
            messagesLoading={inbox.messagesLoading}
            listQuery={inbox.listQuery}
            onListQueryChange={inbox.setListQuery}
            messageQuery={inbox.messageQuery}
            onMessageQueryChange={inbox.setMessageQuery}
            onSelectChat={(c) => void inbox.loadMessages(c)}
            listFilter={listFilter}
            onListFilterChange={setListFilter}
            muteByChatId={muteByChatId}
            todoCount={mutes.length}
            muteBusyChatId={busyChatId}
            onUnmuteChat={(id) => void handleUnmute(id)}
            onMarkChatDone={(id) => void handleMarkDone(id)}
            session={session}
            emptyListHint={
              chatsLoadFailed ? t("console.inbox.chatsDbNotReady") : undefined
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
              chatsLoadFailed ? t("console.inbox.syncWechatDb") : undefined
            }
          />
        )}
        {inbox.error && (
          <p className="mt-2 text-sm text-destructive">{inbox.error}</p>
        )}
      </div>
    </div>
  )
}
