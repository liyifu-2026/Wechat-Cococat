import { useTranslation } from "react-i18next"
import type { ServiceHealth } from "@/lib/stack-status"

const STYLES: Record<ServiceHealth, string> = {
  up: "border-border text-foreground",
  down: "border-border text-muted-foreground",
  degraded: "border-foreground/25 text-foreground",
  unknown: "border-border text-muted-foreground",
}

interface StatusBadgeProps {
  health: ServiceHealth
  label?: string
  className?: string
}

export function StatusBadge({ health, label, className = "" }: StatusBadgeProps) {
  const { t } = useTranslation()
  const text = label ?? t(`console.status.${health}`)
  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-xs font-medium ${STYLES[health]} ${className}`}
    >
      {text}
    </span>
  )
}

interface HealthDotProps {
  health: ServiceHealth
  className?: string
}

export function HealthDot({ health, className = "" }: HealthDotProps) {
  const colors: Record<ServiceHealth, string> = {
    up: "bg-foreground",
    down: "bg-muted-foreground/35",
    degraded: "bg-foreground/45",
    unknown: "bg-muted-foreground/25",
  }
  return (
    <span
      className={`absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-background ${colors[health]} ${className}`}
      aria-hidden
    />
  )
}
