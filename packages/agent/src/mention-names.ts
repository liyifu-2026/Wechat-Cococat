/** WeChat @-mention protocol uses hair space (U+2005) after display names. */
const HAIR_SPACE = "\u2005";

export function isMentionableDisplayName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && !trimmed.startsWith("wxid_");
}

export function extractAtDisplayNames(text: string): string[] {
  const names: string[] = [];
  for (const segment of text.split(HAIR_SPACE)) {
    const token = segment.trim();
    if (token.startsWith("@") || token.startsWith("\uFF20")) {
      const name = token.replace(/^[@\uFF20]+/, "").trim();
      if (isMentionableDisplayName(name)) {
        names.push(name);
      }
    }
  }
  return names;
}

export function resolveForReply(
  senderName: string | undefined,
  rawContent: string | undefined,
  mentionDisplayName: string | undefined,
): string[] {
  if (mentionDisplayName && isMentionableDisplayName(mentionDisplayName)) {
    return [mentionDisplayName];
  }
  if (senderName && isMentionableDisplayName(senderName)) {
    return [senderName];
  }
  if (rawContent) {
    const first = extractAtDisplayNames(rawContent)[0];
    if (first) return [first];
  }
  return [];
}

/** Strip leading @Name tokens the model echoed when FSM inserts real mentions. */
export function stripLeadingAtMentions(text: string, mentions: string[]): string {
  let rest = text.trimStart();
  for (const name of mentions) {
    for (const prefix of [`@${name}`, `@${name}${HAIR_SPACE}`]) {
      if (rest.startsWith(prefix)) {
        rest = rest.slice(prefix.length).trimStart();
      }
    }
  }
  return rest;
}
