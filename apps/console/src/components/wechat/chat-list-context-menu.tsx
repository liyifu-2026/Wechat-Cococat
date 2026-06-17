import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { useContextMenuDismiss } from "@/hooks/use-context-menu-dismiss"
import { WECHAT_DIALOG_PORTAL_ID } from "@/hooks/use-wechat-dialog-portal"

function getInboxPortalContainer(): HTMLElement {
  return document.getElementById(WECHAT_DIALOG_PORTAL_ID) ?? document.body
}

export type ChatListContextMenuProps = {
  x: number
  y: number
  isMaintainer: boolean
  isPinned: boolean
  isTodo: boolean
  isMuted: boolean
  onClose: () => void
  onTogglePin: () => void
  onToggleMaintainer: () => void
  onMarkTodo: () => void
  onMarkDone: () => void
  onMute: () => void
  onUnmute: () => void
}

function MenuButton({
  children,
  onClick,
  accent = false,
}: {
  children: React.ReactNode
  onClick: () => void
  accent?: boolean
}) {
  return (
    <button
      type="button"
      className={`block w-full px-3 py-2 text-left hover:bg-[var(--wx-list-hover)] ${
        accent ? "text-[var(--wx-accent)]" : ""
      }`}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

export function ChatListContextMenu({
  x,
  y,
  isMaintainer,
  isPinned,
  isTodo,
  isMuted,
  onClose,
  onTogglePin,
  onToggleMaintainer,
  onMarkTodo,
  onMarkDone,
  onMute,
  onUnmute,
}: ChatListContextMenuProps) {
  const { t } = useTranslation()
  useContextMenuDismiss(true, onClose)

  const closeAfter = (action: () => void) => () => {
    action()
    onClose()
  }

  return createPortal(
    <div
      className="inbox-frosted-surface fixed z-[200] min-w-[10rem] rounded-lg border border-[var(--wx-border)] py-1 text-xs text-[var(--wx-text)] shadow-xl ring-1 ring-black/10 dark:ring-white/10"
      style={{ top: y, left: x }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {!isMaintainer && (
        <>
          <MenuButton onClick={closeAfter(onTogglePin)}>
            {isPinned ? t("wechat.inbox.unpinChat") : t("wechat.inbox.pinChat")}
          </MenuButton>
          <div className="my-1 border-t border-[var(--wx-border)]" />
        </>
      )}
      <MenuButton accent onClick={closeAfter(onToggleMaintainer)}>
        {isMaintainer
          ? t("wechat.inbox.removeMaintainer")
          : t("wechat.inbox.setMaintainer")}
      </MenuButton>
      <div className="my-1 border-t border-[var(--wx-border)]" />
      {isTodo ? (
        <MenuButton onClick={closeAfter(onMarkDone)}>
          {t("wechat.inbox.contextMarkDone")}
        </MenuButton>
      ) : (
        <MenuButton onClick={closeAfter(onMarkTodo)}>
          {t("wechat.inbox.contextMarkTodo")}
        </MenuButton>
      )}
      {isMuted ? (
        <MenuButton onClick={closeAfter(onUnmute)}>
          {t("wechat.inbox.contextUnmute")}
        </MenuButton>
      ) : (
        <MenuButton onClick={closeAfter(onMute)}>
          {t("wechat.inbox.contextMute")}
        </MenuButton>
      )}
    </div>,
    getInboxPortalContainer(),
  )
}
