import { useTranslation } from "react-i18next"
import {
  LAYOUT_KEYS,
  SYSTEM_PANELS,
  type SystemPanel,
} from "@/lib/console-layout"
import { cn } from "@/lib/utils"

type SystemSidebarProps = {
  active: SystemPanel
  onChange: (panel: SystemPanel) => void
}

export function SystemSidebar({ active, onChange }: SystemSidebarProps) {
  const { t } = useTranslation()

  return (
    <nav
      className="flex w-[200px] shrink-0 flex-col border-r bg-card px-2.5 py-4"
      aria-label={t("console.system.title")}
    >
      {SYSTEM_PANELS.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => {
            onChange(id)
            try {
              localStorage.setItem(LAYOUT_KEYS.systemPanel, id)
            } catch {
              // ignore
            }
          }}
          className={cn(
            "mb-0.5 w-full rounded-md px-3.5 py-2.5 text-left text-sm font-medium transition-colors",
            active === id
              ? "bg-primary/10 text-primary"
              : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
          aria-current={active === id ? "page" : undefined}
        >
          {t(`console.system.panels.${id}`)}
        </button>
      ))}
    </nav>
  )
}
