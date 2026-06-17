import { useCallback, useEffect, useState, type ReactNode } from "react"
import { Minus, Square, X } from "lucide-react"
import { useTranslation } from "react-i18next"
import {
  closeWindow,
  isTauri,
  isWindowMaximized,
  minimizeWindow,
  showCustomWindowControls,
  toggleMaximizeWindow,
} from "@/lib/tauri-window"
import { cn } from "@/lib/utils"

type Layout = "horizontal" | "vertical"

export function WechatWindowControls({
  layout = "vertical",
  className,
}: {
  layout?: Layout
  className?: string
}) {
  const { t } = useTranslation()
  const [maximized, setMaximized] = useState(false)

  const syncMaximized = useCallback(async () => {
    setMaximized(await isWindowMaximized())
  }, [])

  useEffect(() => {
    if (!showCustomWindowControls()) return
    void syncMaximized()
    let unlisten: (() => void) | undefined
    void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
      void getCurrentWindow()
        .onResized(() => {
          void syncMaximized()
        })
        .then((fn) => {
          unlisten = fn
        })
    })
    return () => unlisten?.()
  }, [syncMaximized])

  if (!showCustomWindowControls()) return null

  return (
    <div
      className={cn(
        "wechat-window-controls flex shrink-0",
        layout === "vertical" ? "flex-col items-stretch" : "flex-row items-stretch",
        className,
      )}
    >
      <ChromeButton
        label={t("wechat.window.minimize")}
        onClick={() => void minimizeWindow()}
        compact={layout === "vertical"}
      >
        <Minus className="h-3 w-3" />
      </ChromeButton>
      <ChromeButton
        label={
          maximized
            ? t("wechat.window.restore")
            : t("wechat.window.maximize")
        }
        onClick={() => void toggleMaximizeWindow().then(syncMaximized)}
        compact={layout === "vertical"}
      >
        <Square className={cn("h-2.5 w-2.5", maximized && "h-2 w-2")} />
      </ChromeButton>
      <ChromeButton
        label={t("wechat.window.close")}
        className="hover:bg-red-600/90 hover:text-white"
        onClick={() => void closeWindow()}
        compact={layout === "vertical"}
      >
        <X className="h-3 w-3" />
      </ChromeButton>
    </div>
  )
}

/** Dedicated titlebar row (Win/Linux Tauri). Use `seamless` when stacked above chat header. */
export function WechatWindowTitleBar({ seamless = false }: { seamless?: boolean }) {
  const syncMaximize = useCallback(async () => {
    await toggleMaximizeWindow()
  }, [])

  if (!showCustomWindowControls()) return null

  return (
    <header
      className={cn(
        "wechat-window-titlebar flex h-8 shrink-0 select-none items-stretch bg-[var(--wx-header-bg)]",
        !seamless && "border-b border-[var(--wx-border)]",
      )}
      data-tauri-drag-region
      onDoubleClick={() => void syncMaximize()}
    >
      <div className="min-w-0 flex-1" data-tauri-drag-region />
      <WechatWindowControls layout="horizontal" />
    </header>
  )
}

/** Window controls + chat header as one chrome block (dialog column only). */
export function WechatChatChrome({
  className,
  children,
}: {
  className?: string
  children?: ReactNode
}) {
  const showTitle = showCustomWindowControls()
  if (!showTitle && !children) return null

  return (
    <div
      className={cn(
        "wechat-chat-chrome shrink-0 bg-[var(--wx-header-bg)] border-b border-[var(--wx-border)]",
        className,
      )}
    >
      {showTitle ? <WechatWindowTitleBar seamless /> : null}
      {children}
    </div>
  )
}

/** Drag region strip + Tauri header reserve (pr / macOS top inset). */
export function WechatShellTopBar({
  className,
  children,
}: {
  className?: string
  children?: ReactNode
}) {
  return (
    <header
      className={cn(
        "wechat-shell-topbar flex shrink-0 items-center gap-3 border-b border-[var(--wx-border)] bg-[var(--wx-header-bg)] px-4 py-2.5",
        className,
      )}
      data-tauri-drag-region={isTauri() ? true : undefined}
    >
      {children}
    </header>
  )
}

/** Drag region for login / pre-main shell when NavRail is hidden. */
export function WechatLoginTitleBar() {
  const syncMaximize = useCallback(async () => {
    await toggleMaximizeWindow()
  }, [])

  if (!isTauri()) return null

  return (
    <header
      className="wechat-login-titlebar flex h-8 shrink-0 select-none items-stretch border-b border-[var(--wx-border)]/40 bg-[var(--wechat-nav-bg)]"
      data-tauri-drag-region
      onDoubleClick={() => void syncMaximize()}
    >
      <div className="min-w-0 flex-1" data-tauri-drag-region />
      <WechatWindowControls layout="horizontal" />
    </header>
  )
}

function ChromeButton({
  label,
  onClick,
  className,
  compact,
  children,
}: {
  label: string
  onClick: () => void
  className?: string
  compact?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "flex items-center justify-center text-[var(--wx-muted)] transition-colors hover:bg-[var(--wx-list-hover)] hover:text-[var(--wx-text)]",
        compact ? "h-7 w-full" : "h-8 w-10",
        className,
      )}
      onClick={onClick}
    >
      {children}
    </button>
  )
}
