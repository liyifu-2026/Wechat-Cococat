import { useEffect } from "react"

/** Sync compose footer height to --wechat-compose-height for AI assist panel alignment. */
export function useComposeHeightVar(enabled = true) {
  useEffect(() => {
    if (!enabled) return

    const root = document.documentElement
    const measure = () => {
      const el = document.querySelector(".inbox-compose-footer")
      const h = el?.getBoundingClientRect().height ?? 0
      root.style.setProperty("--wechat-compose-height", `${Math.round(h)}px`)
    }

    measure()
    const ro = new ResizeObserver(measure)
    const el = document.querySelector(".inbox-compose-footer")
    if (el) ro.observe(el)

    window.addEventListener("resize", measure)
    return () => {
      ro.disconnect()
      window.removeEventListener("resize", measure)
    }
  }, [enabled])
}
