import { useEffect } from "react"
import { isTauri } from "@/lib/tauri-window"

/** Close a context menu on outside click, Escape, or Tauri window blur. */
export function useContextMenuDismiss(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return

    let unlistenFocus: (() => void) | undefined
    let clickRegistered = false

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose()
    }

    const onClick = () => onClose()

    document.addEventListener("keydown", onKey)

    const raf = requestAnimationFrame(() => {
      document.addEventListener("click", onClick)
      clickRegistered = true
    })

    if (isTauri()) {
      void import("@tauri-apps/api/window").then(({ getCurrentWindow }) => {
        void getCurrentWindow()
          .onFocusChanged(({ payload: focused }) => {
            if (!focused) onClose()
          })
          .then((unlisten) => {
            unlistenFocus = unlisten
          })
      })
    }

    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener("keydown", onKey)
      if (clickRegistered) document.removeEventListener("click", onClick)
      unlistenFocus?.()
    }
  }, [open, onClose])
}
