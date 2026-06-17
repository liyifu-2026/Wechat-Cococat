import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { useLintStore } from "@/stores/lint-store"
import { useReviewStore } from "@/stores/review-store"
import { useToastStore } from "@/stores/toast-store"

export function useKbAttentionCount(): number {
  const reviewPending = useReviewStore(
    (s) => s.items.filter((i) => !i.resolved).length,
  )
  const lintCount = useLintStore((s) => s.items.length)
  return reviewPending + lintCount
}

/** Toast when knowledge-base pending work increases (review / lint). */
export function useKbAttentionAlerts(): void {
  const { t } = useTranslation()
  const addToast = useToastStore((s) => s.addToast)
  const count = useKbAttentionCount()
  const prevRef = useRef(0)
  const bootRef = useRef(true)

  useEffect(() => {
    if (bootRef.current) {
      bootRef.current = false
      prevRef.current = count
      return
    }
    if (count > prevRef.current) {
      addToast(t("wechat.kb.attentionToast", { count }), "info")
    }
    prevRef.current = count
  }, [addToast, count, t])
}
