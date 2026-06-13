import type { ReactNode } from "react"
import { ErrorBoundary } from "@/components/error-boundary"
import { ToastContainer } from "@/components/ui/toast"
import { CommandPalette } from "./command-palette"
import { ConsoleTopbar } from "./console-topbar"
import { ConsoleRail } from "./console-rail"
import { InboxMutePoller } from "./inbox-mute-poller"
import { StackHealthAlerts } from "./stack-health-alerts"
import { StackHealthPoller } from "./stack-health-poller"

interface ConsoleShellProps {
  children: ReactNode
}

export function ConsoleShell({ children }: ConsoleShellProps) {
  return (
    <ErrorBoundary>
      <StackHealthAlerts />
      <StackHealthPoller />
      <InboxMutePoller />
      <CommandPalette />
      <div className="flex h-screen gap-2 bg-background p-2 text-foreground">
        <ConsoleRail />
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
          <ConsoleTopbar />
          <div className="h-full min-h-0 flex-1 overflow-hidden">{children}</div>
        </div>
      </div>
      <ToastContainer />
    </ErrorBoundary>
  )
}
