import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export interface WikiWorkspaceProps {
  /** Left slot: project tree (e.g. KnowledgeTree) */
  tree?: ReactNode
  /** Optional footer under the tree column (e.g. ActivityPanel) */
  treeFooter?: ReactNode
  /** Center slot: primary work surface */
  main: ReactNode
  /** Right slot: preview / inspector drawer (e.g. PreviewPanel) */
  inspector?: ReactNode
  className?: string
}

/**
 * Phase 6B: shared Wiki workspace layout — tree | main | inspector.
 * Pure presentation; no store or routing logic.
 */
export function WikiWorkspace({
  tree,
  treeFooter,
  main,
  inspector,
  className,
}: WikiWorkspaceProps) {
  return (
    <div
      className={cn(
        "relative flex h-full min-h-0 w-full overflow-hidden bg-background",
        className,
      )}
    >
      {tree ? (
        <aside className="flex min-h-0 w-[240px] shrink-0 flex-col overflow-hidden border-r bg-muted/20">
          <div className="console-scroll-container min-h-0 flex-1 overflow-y-auto">{tree}</div>
          {treeFooter}
        </aside>
      ) : null}

      <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-muted/10">
        <div className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
          {main}
        </div>
      </main>

      {inspector ? (
        <aside className="flex min-h-0 w-[400px] shrink-0 flex-col overflow-hidden border-l bg-card">
          <div className="console-scroll-container min-h-0 flex-1 overflow-y-auto">{inspector}</div>
        </aside>
      ) : null}
    </div>
  )
}
