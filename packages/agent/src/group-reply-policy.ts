import type { Message } from "@cococat/shared";
import type { ChatContext } from "./chat-store.js";
import {
  policyFor,
  type GroupConfig,
  type GroupPolicy,
} from "./group-config.js";
import { isMentionableDisplayName, resolveForReply } from "./mention-names.js";

export type { GroupConfig, GroupPolicy } from "./group-config.js";
export { resolveGroupConfig } from "./effective-config.js";
export { policyFor } from "./group-config.js";

/** @ mention segments from inbound messages. */
export type MentionSegment = {
  senderName: string;
  isMentioned: boolean;
};

export function pushGroupBuffer(
  buffers: Map<string, Message[]>,
  chatId: string,
  messages: Message[],
  limit: number,
): void {
  if (messages.length === 0) return;
  const buf = buffers.get(chatId) ?? [];
  buf.push(...messages);
  if (buf.length > limit) {
    buf.splice(0, buf.length - limit);
  }
  buffers.set(chatId, buf);
}

export function drainGroupBuffer(
  buffers: Map<string, Message[]>,
  chatId: string,
): Message[] {
  const buf = buffers.get(chatId) ?? [];
  buffers.delete(chatId);
  return buf;
}

export function clearGroupBuffer(
  buffers: Map<string, Message[]>,
  chatId: string,
): void {
  buffers.delete(chatId);
}

export function effectiveGroupPolicy(
  base: GroupPolicy,
  chatCtx: Pick<ChatContext, "style">,
): GroupPolicy {
  if (chatCtx.style.groupMode === "member") {
    return {
      requireMention: false,
      replyWithMention: "none",
    };
  }
  return base;
}

/** Per-chat policy after bridge-groups + style.groupMode overrides. */
export function resolveGroupPolicy(
  config: GroupConfig,
  chatId: string,
  chatCtx: Pick<ChatContext, "style">,
): GroupPolicy {
  return effectiveGroupPolicy(policyFor(config, chatId), chatCtx);
}

export function shouldSkipGroupMessage(
  requireMention: boolean,
  wasMentioned: boolean,
): boolean {
  return requireMention && !wasMentioned;
}

export function resolveReplyMentions(
  segment: MentionSegment[],
  policy: GroupPolicy,
): string[] | undefined {
  switch (policy.replyWithMention) {
    case "none":
      return undefined;
    case "all": {
      const names: string[] = [];
      const seen = new Set<string>();
      for (const entry of segment) {
        if (!entry.isMentioned) continue;
        if (
          !isMentionableDisplayName(entry.senderName) ||
          seen.has(entry.senderName)
        ) {
          continue;
        }
        seen.add(entry.senderName);
        names.push(entry.senderName);
      }
      return names.length > 0 ? names : undefined;
    }
    case "trigger": {
      const trigger =
        [...segment].reverse().find((e) => e.isMentioned) ??
        segment[segment.length - 1];
      if (!trigger || !isMentionableDisplayName(trigger.senderName)) {
        return undefined;
      }
      return [trigger.senderName];
    }
  }
}

/** Resolve outbound @ targets for a group reply turn. */
export function buildOutboundMentions(
  isGroup: boolean,
  unseen: Message[],
  policy: GroupPolicy,
): string[] | undefined {
  if (!isGroup) return undefined;

  const segments: MentionSegment[] = unseen
    .filter((m) => m.senderName)
    .map((m) => ({
      senderName: m.senderName!,
      isMentioned: m.isMentioned ?? false,
    }));

  const policyNames = resolveReplyMentions(segments, policy);
  if (!policyNames) return undefined;

  const resolved: string[] = [];
  for (const name of policyNames) {
    const msg = [...unseen]
      .reverse()
      .find((m) => m.isMentioned && m.senderName === name);
    const fallback = [...unseen].reverse().find((m) => m.senderName === name);
    const target = msg ?? fallback;
    if (!target) continue;
    resolved.push(
      ...resolveForReply(
        target.senderName ?? target.sender,
        target.content,
        target.senderName,
      ),
    );
  }
  return resolved.length > 0 ? resolved : undefined;
}

export type GroupInboundMode = "fast" | "full";

export type GroupInboundResult =
  | { action: "buffer"; unseen: Message[]; groupPolicy: GroupPolicy }
  | {
      action: "continue";
      unseen: Message[];
      wasMentioned: boolean;
      groupPolicy: GroupPolicy;
      injectedBufferCount: number;
    };

/** Group @ / buffer gate shared by inbound-gate fast and full paths. */
export function applyGroupInbound(params: {
  chatId: string;
  isGroup: boolean;
  unseen: Message[];
  group: GroupConfig;
  groupBuffers: Map<string, Message[]>;
  chatCtx: ChatContext;
  mode: GroupInboundMode;
}): GroupInboundResult {
  const { chatId, isGroup, group, groupBuffers, chatCtx, mode } = params;
  let unseen = params.unseen;
  const isGroupChat = isGroup || chatId.includes("@chatroom");
  const groupPolicy = resolveGroupPolicy(group, chatId, chatCtx);
  const wasMentioned = unseen.some((m) => m.isMentioned === true);

  if (!isGroupChat) {
    return {
      action: "continue",
      unseen,
      wasMentioned,
      groupPolicy,
      injectedBufferCount: 0,
    };
  }

  if (shouldSkipGroupMessage(groupPolicy.requireMention, wasMentioned)) {
    pushGroupBuffer(groupBuffers, chatId, unseen, group.groupHistoryLimit);
    return { action: "buffer", unseen, groupPolicy };
  }

  let injectedBufferCount = 0;

  if (mode === "full" && wasMentioned) {
    const buffered = drainGroupBuffer(groupBuffers, chatId);
    if (buffered.length > 0) {
      injectedBufferCount = buffered.length;
      for (const msg of buffered) {
        msg.isMentioned = true;
      }
      unseen = [...buffered, ...unseen].sort(
        (a, b) => a.localId - b.localId,
      );
    }
  } else if (mode === "full" && !groupPolicy.requireMention) {
    clearGroupBuffer(groupBuffers, chatId);
  }

  return {
    action: "continue",
    unseen,
    wasMentioned,
    groupPolicy,
    injectedBufferCount,
  };
}
