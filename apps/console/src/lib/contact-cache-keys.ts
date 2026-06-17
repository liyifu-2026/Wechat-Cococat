import type { DriverChat } from "@/lib/driver-types"

/** Collect wxid / chat keys worth prefetching for avatar + display name. */
export function contactKeysFromChats(chats: Iterable<DriverChat>): string[] {
  const ids = new Set<string>()
  for (const chat of chats) {
    const username = chat.username?.trim()
    const id = chat.id?.trim()
    if (username) ids.add(username)
    if (id && id !== username) ids.add(id)
  }
  return [...ids]
}

export function contactKeysFromMessages(
  messages: Iterable<{ sender?: string }>,
  extra: Iterable<string | null | undefined> = [],
): string[] {
  const ids = new Set<string>()
  for (const key of extra) {
    const id = key?.trim()
    if (id) ids.add(id)
  }
  for (const m of messages) {
    const sender = m.sender?.trim()
    if (sender) ids.add(sender)
  }
  return [...ids]
}
