import type { ReactNode } from "react"
import { ErrorBoundary } from "@/components/error-boundary"
import { ToastContainer } from "@/components/ui/toast"
import { CommandPalette } from "@/components/console/command-palette"
import { InboxMutePoller } from "@/components/console/inbox-mute-poller"
import { EscalationMuteAlerts } from "@/components/console/escalation-mute-alerts"
import { StackHealthAlerts } from "@/components/console/stack-health-alerts"
import { KbAttentionAlerts } from "@/components/console/kb-attention-alerts"
import { StackHealthPoller } from "@/components/console/stack-health-poller"
import { InboxModule } from "@/components/console/inbox-module"
import { WechatNavRail } from "@/components/wechat/wechat-nav-rail"
import { WechatLoginOverlay } from "@/components/wechat/wechat-login-overlay"
import { WechatSettingsModal } from "@/components/wechat/wechat-settings-modal"
import { ContactsPanel } from "@/components/wechat/contacts-panel"
import { WechatKnowledgePanel } from "@/components/wechat/wechat-knowledge-panel"
import { InboxImageLightbox } from "@/components/console/inbox-image-lightbox"
import { useWechatShellPlatform } from "@/hooks/use-wechat-shell-platform"
import { useStackLifecycle } from "@/hooks/use-stack-lifecycle"
import { useSeamlessStartup } from "@/hooks/use-seamless-startup"
import { isTauri } from "@/lib/tauri-window"
import { INBOX_AI_BUBBLE_PORTAL_ID } from "@/lib/inbox-ai-hosts"
import { useConsoleStore } from "@/stores/console-store"

type WechatShellProps = {
  children?: ReactNode
}

export function WechatShell({ children }: WechatShellProps) {
  const startup = useSeamlessStartup()
  useStackLifecycle()
  useWechatShellPlatform()
  const activeWechatTab = useConsoleStore((s) => s.activeWechatTab)
  const showMain = startup.phase === "ready" && startup.loggedIn

  return (
    <ErrorBoundary>
      <StackHealthAlerts />
      <KbAttentionAlerts />
      <StackHealthPoller />
      <InboxMutePoller />
      <EscalationMuteAlerts />
      <CommandPalette />
      <WechatSettingsModal />
      <InboxImageLightbox />

      <div
        className={`flex h-screen flex-col overflow-hidden bg-[var(--wechat-dark-bg)] ${isTauri() ? "wechat-shell-frameless" : ""}`}
      >
        {showMain ? (
          <div className="wechat-shell inbox-shell flex min-h-0 flex-1 overflow-hidden text-[var(--wx-text)]">
            <WechatNavRail />
            <main className="relative min-h-0 min-w-0 flex-1 overflow-hidden">
              {children ?? (
                <>
                  <div
                    className={
                      activeWechatTab === "chats"
                        ? "h-full min-h-0"
                        : "hidden"
                    }
                    aria-hidden={activeWechatTab !== "chats"}
                  >
                    <ErrorBoundary>
                    <InboxModule />
                    </ErrorBoundary>
                  </div>
                  {activeWechatTab === "contacts" && (
                    <div className="h-full min-h-0">
                      <ErrorBoundary>
                      <ContactsPanel />
                      </ErrorBoundary>
                    </div>
                  )}
                  {activeWechatTab === "kb" && (
                    <div className="h-full min-h-0">
                      <ErrorBoundary>
                      <WechatKnowledgePanel />
                      </ErrorBoundary>
                    </div>
                  )}
                </>
              )}
            </main>
            <div
              id="wechat-dialog-portal"
              className="pointer-events-none fixed inset-0 z-[100] [&>*]:pointer-events-auto"
              aria-hidden="true"
            />
            <div
              id={INBOX_AI_BUBBLE_PORTAL_ID}
              className="pointer-events-none fixed inset-0 z-[55]"
              aria-hidden="true"
            />
          </div>
        ) : (
          <WechatLoginOverlay
            phase={startup.phase}
            bootStatus={startup.bootStatus}
            errorMessage={startup.errorMessage}
            onRetryBoot={startup.retry}
            onLoginSuccess={startup.completeLogin}
          />
        )}
      </div>

      <ToastContainer />
    </ErrorBoundary>
  )
}
