import type { ReactNode } from "react"

type InboxAiLiquidGlassProps = {
  children: ReactNode
  className?: string
  id?: string
  /** Smaller trigger bubble uses a single aurora blob */
  variant?: "panel" | "trigger"
}

export function InboxAiLiquidGlass({
  children,
  className = "",
  id,
  variant = "panel",
}: InboxAiLiquidGlassProps) {
  return (
    <div
      id={id}
      className={`inbox-ai-liquid-glass ${variant === "panel" ? "inbox-ai-glass-face" : ""} ${className}`.trim()}
    >
      {variant === "panel" ? (
        <>
          <div className="inbox-ai-aurora-blob inbox-ai-aurora-blob--a" aria-hidden />
          <div className="inbox-ai-aurora-blob inbox-ai-aurora-blob--b" aria-hidden />
          <div className="inbox-ai-aurora-blob inbox-ai-aurora-blob--c" aria-hidden />
        </>
      ) : (
        <div
          className="inbox-ai-aurora-blob inbox-ai-aurora-blob--a"
          style={{ inset: "-60%", width: "auto", height: "auto" }}
          aria-hidden
        />
      )}
      <div className="inbox-ai-liquid-glass__content">{children}</div>
    </div>
  )
}
