import { useEffect, useState } from "react"
import { Monitor } from "lucide-react"
import { useTranslation } from "react-i18next"
import { useStackHealth } from "@/hooks/use-stack-health"
import { openWechatVncInBrowser } from "@/lib/wechat-vnc"
import { readCococatToken } from "@/lib/stack-client"
import { cn } from "@/lib/utils"

type WechatVncNavButtonProps = {
  className?: string
}

/** Settings sidebar shortcut — opens noVNC in system browser. */
export function WechatVncNavButton({ className }: WechatVncNavButtonProps) {
  const { t } = useTranslation()
  const health = useStackHealth()
  const [hasToken, setHasToken] = useState(false)

  useEffect(() => {
    void readCococatToken()
      .then((token) => setHasToken(Boolean(token?.trim())))
      .catch(() => setHasToken(false))
  }, [health.driver])

  const ready = health.driver === "up" && hasToken

  if (!ready) return null

  return (
    <button
      type="button"
      onClick={() => void openWechatVncInBrowser()}
      className={cn(
        "mx-2 flex w-[calc(100%-1rem)] items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-[var(--wx-muted)] transition-colors hover:bg-[var(--wx-list-hover)] hover:text-[var(--wx-text)]",
        className,
      )}
      title={t("console.wechat.openVncBrowser")}
      aria-label={t("console.wechat.vnc")}
    >
      <Monitor className="h-4 w-4 shrink-0 text-emerald-400" />
      <span>{t("console.wechat.vnc")}</span>
    </button>
  )
}
