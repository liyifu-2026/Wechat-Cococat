import { LAYOUT_KEYS } from "@/lib/console-layout"

export function getStackNotificationsEnabled(): boolean {
  try {
    return localStorage.getItem(LAYOUT_KEYS.stackNotifications) === "1"
  } catch {
    return false
  }
}

export function setStackNotificationsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(LAYOUT_KEYS.stackNotifications, enabled ? "1" : "0")
  } catch {
    // ignore
  }
}

/**
 * System notification when the window is not focused (Phase 5).
 * Skips OS notifications on Linux desktop — GNOME/dunst play audible event sounds.
 * In-app toasts are always shown separately by useStackHealthAlerts.
 */
export async function notifyStackAlert(_title: string, _body: string): Promise<void> {
  if (typeof navigator !== "undefined" && /Linux/i.test(navigator.userAgent)) {
    return
  }

  try {
    const { isPermissionGranted, requestPermission, sendNotification } = await import(
      "@tauri-apps/plugin-notification"
    )
    let granted = await isPermissionGranted()
    if (!granted) {
      const perm = await requestPermission()
      granted = perm === "granted"
    }
    if (granted) {
      await sendNotification({ title: _title, body: _body })
      return
    }
  } catch {
    // fall through to Web Notifications
  }

  if (typeof Notification === "undefined") return
  if (Notification.permission === "default") {
    await Notification.requestPermission()
  }
  if (Notification.permission === "granted") {
    new Notification(_title, { body: _body, silent: true })
  }
}

export function shouldSendStackNotification(): boolean {
  return getStackNotificationsEnabled() && !document.hasFocus()
}
