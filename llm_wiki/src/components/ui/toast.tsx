import { useToastStore } from "@/stores/toast-store"
import type { Toast } from "@/stores/toast-store"
import { X, CheckCircle, AlertCircle, Info } from "lucide-react"
import { cn } from "@/lib/utils"

const iconMap: Record<Toast["type"], typeof CheckCircle> = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
}

const colorMap: Record<Toast["type"], string> = {
  success: "border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950/40",
  error: "border-destructive/30 bg-red-50 dark:bg-red-950/40",
  info: "border-accent/30 bg-accent/5",
}

function ToastItem({ toast }: { toast: Toast }) {
  const removeToast = useToastStore((s) => s.removeToast)
  const Icon = iconMap[toast.type]

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg backdrop-blur",
        "animate-in slide-in-from-right-full fade-in duration-300",
        colorMap[toast.type]
      )}
    >
      <Icon className="h-4 w-4 shrink-0 text-foreground/70" />
      <p className="text-sm flex-1">{toast.message}</p>
      <button
        onClick={() => removeToast(toast.id)}
        className="text-foreground/40 hover:text-foreground transition-colors"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts)

  if (toasts.length === 0) return null

  return (
    <div className="fixed top-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  )
}
