import { cn } from "@/lib/utils"

export interface ModuleTabItem<T extends string> {
  id: T
  label: string
}

interface ModuleTabsProps<T extends string> {
  tabs: ModuleTabItem<T>[]
  active: T
  onChange: (id: T) => void
  className?: string
  /** Accessible label for the tab list. */
  ariaLabel?: string
}

/**
 * Shared top tab bar for Console modules (Stack, WeChat, Memory, Agent, Wiki, Settings groups).
 */
export function ModuleTabs<T extends string>({
  tabs,
  active,
  onChange,
  className,
  ariaLabel = "Module sections",
}: ModuleTabsProps<T>) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "flex shrink-0 gap-0 border-b border-border px-5",
        className,
      )}
    >
      {tabs.map((tab) => {
        const selected = tab.id === active
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={cn(
              "border-b-2 px-3.5 py-2.5 text-sm transition-colors -mb-px",
              selected
                ? "border-foreground font-medium text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        )
      })}
    </div>
  )
}
