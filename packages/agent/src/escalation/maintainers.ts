import type { MaintainerInfo } from "./types.js";

export function parseMaintainerEntry(raw: unknown): MaintainerInfo | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const chatId = typeof o.chatId === "string" ? o.chatId.trim() : "";
  const displayName =
    typeof o.displayName === "string" ? o.displayName.trim() : "";
  if (!chatId && !displayName) return null;
  return { chatId, displayName };
}

/** Parse maintainers[] with legacy `maintainer` fallback; dedupe by chatId. */
export function parseMaintainersFromRaw(
  raw: Record<string, unknown>,
): MaintainerInfo[] {
  const list: MaintainerInfo[] = [];

  if (Array.isArray(raw.maintainers)) {
    for (const item of raw.maintainers) {
      const entry = parseMaintainerEntry(item);
      if (entry) list.push(entry);
    }
  }

  if (list.length === 0) {
    const legacy = parseMaintainerEntry(raw.maintainer);
    if (legacy) list.push(legacy);
  }

  const seen = new Set<string>();
  return list.filter((m) => {
    if (!m.chatId) return true;
    if (seen.has(m.chatId)) return false;
    seen.add(m.chatId);
    return true;
  });
}

export function maintainerIdentityFromList(maintainers: MaintainerInfo[]): string {
  const ids = maintainers
    .map((m) => m.chatId.trim())
    .filter(Boolean)
    .sort();
  return ids.join("|");
}

export function displayNameForMaintainerChat(
  maintainers: MaintainerInfo[],
  chatId: string,
): string {
  const hit = maintainers.find((m) => m.chatId === chatId);
  return hit?.displayName?.trim() || chatId;
}
