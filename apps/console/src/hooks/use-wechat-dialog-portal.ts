import { useLayoutEffect, useState } from "react"

export const WECHAT_DIALOG_PORTAL_ID = "wechat-dialog-portal"

/** Portal mount inside `.wechat-shell.inbox-shell` so wx tokens apply to dialogs. */
export function useWechatDialogPortal(enabled = true) {
  const [container, setContainer] = useState<HTMLElement | null>(() =>
    enabled ? document.getElementById(WECHAT_DIALOG_PORTAL_ID) : null,
  )

  useLayoutEffect(() => {
    if (!enabled) {
      setContainer(null)
      return
    }
    setContainer(document.getElementById(WECHAT_DIALOG_PORTAL_ID))
  }, [enabled])

  return container
}
