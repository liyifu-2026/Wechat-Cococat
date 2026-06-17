export type ReplyInfo = {
  sender?: string
  content: string
}

/** Driver message payload (matches Rust `Message` JSON). */
export type DriverMessage = {
  localId: number
  serverId?: number
  chatId?: string
  sender?: string
  senderName?: string
  type: number
  content: string
  timestamp: string
  isMentioned?: boolean
  isSelf?: boolean
  reply?: ReplyInfo
  artifactRef?: string
  mediaKind?: string
  /** Driver-attached id for optimistic send reconcile. */
  clientMsgId?: string
  /** Console-only pending bubble; never from server. */
  pending?: boolean
}

export type DriverContact = {
  username: string
  nickName: string
  remark?: string
  alias?: string
  smallHeadUrl?: string
  contactType: string
}

export type DriverChat = {
  id: string
  name?: string
  username?: string
  remark?: string
  lastMessagePreview?: string
  lastMessageSender?: string
  lastActivityAt?: string
  isGroup?: boolean
  unreadCount?: number
  smallHeadUrl?: string
}

export function contactDisplayName(c: DriverContact): string {
  return c.remark?.trim() || c.nickName?.trim() || c.alias?.trim() || c.username
}

/** Synthetic chat for contacts without an existing conversation row. */
export function contactToChat(contact: DriverContact): DriverChat {
  return {
    id: contact.username,
    name: contactDisplayName(contact),
    username: contact.username,
    remark: contact.remark,
    smallHeadUrl: contact.smallHeadUrl,
    isGroup: false,
  }
}

export function minimalChatFromId(chatId: string): DriverChat {
  return {
    id: chatId,
    username: chatId,
    isGroup: false,
  }
}
