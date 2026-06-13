export type NewMessagesChatInfo = {
  chatId: string;
  name: string;
  unreadCount: number;
  isGroup: boolean;
  lastMsgTime?: string;
};

export type NewMessagesEvent = {
  type: "new_messages";
  chats: NewMessagesChatInfo[];
  timestamp: string;
};

export function isNewMessagesEvent(value: unknown): value is NewMessagesEvent {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return v.type === "new_messages" && Array.isArray(v.chats);
}
