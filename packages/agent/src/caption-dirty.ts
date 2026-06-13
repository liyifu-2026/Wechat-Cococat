/** 进程内 caption 脏标记；Phase B 可迁 Redis SET。 */

const dirtyByChat = new Map<string, Set<number>>();

function ensureSet(chatId: string): Set<number> {
  let set = dirtyByChat.get(chatId);
  if (!set) {
    set = new Set();
    dirtyByChat.set(chatId, set);
  }
  return set;
}

export function markCaptionDirty(chatId: string, localId: number): void {
  ensureSet(chatId).add(localId);
}

export function consumeCaptionDirty(chatId: string): number[] {
  const set = dirtyByChat.get(chatId);
  if (!set || set.size === 0) return [];
  const ids = [...set].sort((a, b) => a - b);
  dirtyByChat.delete(chatId);
  return ids;
}

export function peekCaptionDirty(chatId: string): number[] {
  const set = dirtyByChat.get(chatId);
  if (!set || set.size === 0) return [];
  return [...set].sort((a, b) => a - b);
}

export function clearCaptionDirty(chatId: string): void {
  dirtyByChat.delete(chatId);
}
