import { useCallback, useEffect, useRef, useState } from "react"
import { useWikiStore } from "@/stores/wiki-store"
import { listDirectory } from "@/commands/fs"
import { normalizePath } from "@/lib/path-utils"
import { IconSidebar } from "./icon-sidebar"
import { SidebarPanel } from "./sidebar-panel"
import { ContentArea } from "./content-area"
import { PreviewPanel } from "./preview-panel"
import { ActivityPanel } from "./activity-panel"
import { ErrorBoundary } from "@/components/error-boundary"

interface AppLayoutProps {
  onSwitchProject: () => void
}

export function AppLayout({ onSwitchProject }: AppLayoutProps) {
  const project = useWikiStore((s) => s.project)
  const selectedFile = useWikiStore((s) => s.selectedFile)
  const activeView = useWikiStore((s) => s.activeView)
  const setFileTree = useWikiStore((s) => s.setFileTree)
  const [leftWidth, setLeftWidth] = useState(220)
  const [rightWidth, setRightWidth] = useState(400)
  const isDraggingLeft = useRef(false)
  const isDraggingRight = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const loadFileTree = useCallback(async () => {
    if (!project) return
    try {
      const tree = await listDirectory(normalizePath(project.path))
      setFileTree(tree)
    } catch (err) {
      console.error("Failed to load file tree:", err)
    }
  }, [project, setFileTree])

  useEffect(() => {
    loadFileTree()
  }, [loadFileTree])

  const startDrag = useCallback(
    (side: "left" | "right") => (e: React.MouseEvent) => {
      e.preventDefault()
      if (side === "left") isDraggingLeft.current = true
      else isDraggingRight.current = true
      document.body.style.cursor = "col-resize"
      document.body.style.userSelect = "none"
      document.body.dataset.panelResizing = "true"

      const handleMouseMove = (e: MouseEvent) => {
        if (!containerRef.current) return
        const rect = containerRef.current.getBoundingClientRect()

        if (isDraggingLeft.current) {
          const newWidth = e.clientX - rect.left
          // Hard cap: 150 to 400px
          setLeftWidth(Math.max(150, Math.min(400, newWidth)))
        }
        if (isDraggingRight.current) {
          const newWidth = rect.right - e.clientX
          // Hard cap: 250 to 50% of container
          setRightWidth(Math.max(250, Math.min(rect.width * 0.5, newWidth)))
        }
      }

      const handleMouseUp = () => {
        isDraggingLeft.current = false
        isDraggingRight.current = false
        document.body.style.cursor = ""
        document.body.style.userSelect = ""
        delete document.body.dataset.panelResizing
        document.removeEventListener("mousemove", handleMouseMove)
        document.removeEventListener("mouseup", handleMouseUp)
      }

      document.addEventListener("mousemove", handleMouseMove)
      document.addEventListener("mouseup", handleMouseUp)
    },
    []
  )

  // Settings is a full-width admin view — the file tree / activity panel
  // are irrelevant there and their narrow column makes the settings form
  // cramped. Hide both the left sidebar (and the file preview on the
  // right) so the settings screen uses the whole content area.
  const isSettings = activeView === "settings"
  const hasRightPanel = !isSettings && !!selectedFile

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <div className="flex min-h-0 flex-1 gap-3 p-3">
        <IconSidebar onSwitchProject={onSwitchProject} />
        <div ref={containerRef} className="flex min-w-0 flex-1 gap-3">
        {!isSettings && (
          <>
            {/* Left: File tree + Activity */}
            <div
              className="flex shrink-0 flex-col overflow-hidden rounded-2xl bg-muted shadow-lg"
              style={{ width: leftWidth }}
            >
              <div className="flex-1 overflow-hidden">
                <SidebarPanel />
              </div>
              <ActivityPanel />
            </div>
            <div
              className="w-[4px] cursor-col-resize shrink-0 rounded-full bg-transparent hover:bg-accent/25 transition-all duration-200"
              onMouseDown={startDrag("left")}
            />
          </>
        )}

        {/* Center: Chat or view */}
        <div className="min-w-0 flex-1 overflow-hidden rounded-2xl bg-card shadow-xl">
          <ErrorBoundary>
            <ContentArea />
          </ErrorBoundary>
        </div>

        {/* Right panels */}
        {hasRightPanel && (
          <>
            <div
              className="w-[4px] cursor-col-resize shrink-0 rounded-full bg-transparent hover:bg-accent/25 transition-all duration-200"
              onMouseDown={startDrag("right")}
            />
            <div
              className="flex shrink-0 flex-col overflow-hidden rounded-2xl bg-muted shadow-lg"
              style={{ width: rightWidth }}
            >
              <ErrorBoundary>
                <div className="flex-1 overflow-hidden">
                  <PreviewPanel />
                </div>
              </ErrorBoundary>
            </div>
          </>
        )}
        </div>
      </div>
    </div>
  )
}
