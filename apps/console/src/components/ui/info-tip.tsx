import { useState } from "react"
import { Info } from "lucide-react"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

type InfoTipProps = {
  label: string
  className?: string
}

/** Hint icon — hover or click/tap to show full text. */
export function InfoTip({ label, className }: InfoTipProps) {
  const [open, setOpen] = useState(false)

  return (
    <TooltipProvider delay={200}>
      <Tooltip open={open} onOpenChange={setOpen}>
        <TooltipTrigger
          render={
            <button
              type="button"
              className={cn(
                "inline-flex shrink-0 align-middle rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                className,
              )}
              aria-label={label}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                setOpen((prev) => !prev)
              }}
            >
              <Info className="h-3.5 w-3.5" />
            </button>
          }
        />
        <TooltipContent side="top" className="max-w-xs text-left">
          {label}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
