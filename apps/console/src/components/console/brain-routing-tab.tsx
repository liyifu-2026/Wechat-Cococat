import { AgentEscalationTab } from "@/components/console/agent-escalation-tab"

export function BrainRoutingTab() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="wechat-settings-scroll min-h-0 flex-1 overflow-y-auto">
        <AgentEscalationTab />
      </div>
    </div>
  )
}
