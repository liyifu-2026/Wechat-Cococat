import type { WeChatClient } from "@cococat/shared";
import type { MemoryClient } from "../memory-client.js";
import type { WikiClient } from "../wiki-client.js";
import { tryMaintainerWikiOpsReply } from "../ops/wiki-sniff.js";
import {
  formatMemoryPickList,
  formatMemorySnapshot,
  parseMaintainerMemoryCommand,
  resolveMemoryTarget,
} from "../ops/memory-peek.js";
import { pickMaintainerCandidate } from "../ops/pick-candidate.js";
import {
  formatMaintainerBlockedChat,
  formatMaintainerMenu,
} from "./maintainer-menu.js";
import {
  formatMaintainerActionBroadcast,
  formatMuteListMessage,
  formatNoMutesToClear,
  formatUnmutePickPrompt,
} from "./maintainer-notify.js";
import {
  listActiveMutes,
  loadMaintainerPending,
  maintainerMemoryPickTtlMs,
  saveMaintainerPending,
  unmuteChat,
} from "./state-store.js";
import type { MaintainerMessageOutcome } from "./types.js";

export type MaintainerCommandContext = {
  actorChatId: string;
  body: string;
  operatorName: string;
  client: WeChatClient;
  wikiEnabled?: boolean;
  wikiClient?: WikiClient;
  memoryClient?: MemoryClient;
  sendText(chatId: string, text: string): Promise<void>;
  notifyAllMaintainers(text: string): Promise<void>;
};

export type MaintainerCommandResult =
  | MaintainerMessageOutcome
  | undefined;

export type MaintainerCommandHandler = {
  name: string;
  handle(ctx: MaintainerCommandContext): Promise<MaintainerCommandResult>;
};

export async function dispatchMaintainerCommand(
  handlers: MaintainerCommandHandler[],
  ctx: MaintainerCommandContext,
): Promise<MaintainerCommandResult> {
  for (const handler of handlers) {
    const result = await handler.handle(ctx);
    if (result !== undefined) return result;
  }
  return undefined;
}

export function createWikiMaintainerCommandHandler(): MaintainerCommandHandler {
  return {
    name: "wiki",
    async handle(ctx) {
      const reply = await tryMaintainerWikiOpsReply(
        ctx.body,
        ctx.wikiClient,
        ctx.wikiEnabled === true,
      );
      if (reply === null) return undefined;
      await ctx.sendText(ctx.actorChatId, reply);
      return "handled";
    },
  };
}

export function createMemoryMaintainerCommandHandler(): MaintainerCommandHandler {
  return {
    name: "memory",
    async handle(ctx) {
      const pending = loadMaintainerPending();
      if (pending?.action === "pick_memory") {
        const picked = pickMaintainerCandidate(pending.candidates, ctx.body);
        if (!picked) {
          await ctx.sendText(
            ctx.actorChatId,
            "没对上号。请回复序号（如 1）、更完整备注名，或 chatId。",
          );
          return "handled";
        }
        if (!ctx.memoryClient) {
          await ctx.sendText(ctx.actorChatId, "Memory gateway 不可用。");
          saveMaintainerPending(null);
          return "handled";
        }
        saveMaintainerPending(null);
        await ctx.sendText(
          ctx.actorChatId,
          await formatMemorySnapshot(picked, ctx.memoryClient),
        );
        return "handled";
      }

      const memoryQuery = parseMaintainerMemoryCommand(ctx.body);
      if (memoryQuery === null) return undefined;
      if (!ctx.memoryClient) {
        await ctx.sendText(ctx.actorChatId, "Memory gateway 不可用。");
        return "handled";
      }

      const resolved = await resolveMemoryTarget(memoryQuery, ctx.client);
      switch (resolved.kind) {
        case "error":
          await ctx.sendText(ctx.actorChatId, resolved.message);
          return "handled";
        case "single":
          await ctx.sendText(
            ctx.actorChatId,
            await formatMemorySnapshot(resolved.candidate, ctx.memoryClient),
          );
          return "handled";
        case "too_many":
          await ctx.sendText(
            ctx.actorChatId,
            `命中 ${resolved.count} 个，过多。请用 chatId 或更长备注名。`,
          );
          return "handled";
        case "pick":
          saveMaintainerPending({
            action: "pick_memory",
            query: resolved.query,
            candidates: resolved.candidates,
            expiresAt: Date.now() + maintainerMemoryPickTtlMs(),
          });
          await ctx.sendText(
            ctx.actorChatId,
            formatMemoryPickList(resolved.query, resolved.candidates),
          );
          return "handled";
      }
    },
  };
}

export function createMuteMaintainerCommandHandler(): MaintainerCommandHandler {
  return {
    name: "mute",
    async handle(ctx) {
      const pending = loadMaintainerPending();
      if (pending?.action === "pick_unmute") {
        const picked = pickMaintainerCandidate(pending.candidates, ctx.body);
        if (!picked) {
          await ctx.sendText(
            ctx.actorChatId,
            "没对上号。请回复序号（如 1）或客户备注名。",
          );
          return "handled";
        }
        unmuteChat(picked.chatId);
        saveMaintainerPending(null);
        await ctx.notifyAllMaintainers(
          formatMaintainerActionBroadcast(
            ctx.operatorName,
            `已恢复对「${picked.chatName}」的自动回复。`,
          ),
        );
        return "handled";
      }

      if (/^菜单$/u.test(ctx.body)) {
        await ctx.sendText(
          ctx.actorChatId,
          formatMaintainerMenu({ wikiEnabled: ctx.wikiEnabled === true }),
        );
        return "handled";
      }

      if (/^列表$/u.test(ctx.body)) {
        await ctx.sendText(ctx.actorChatId, formatMuteListMessage());
        return "handled";
      }

      if (/^(已处理|解除)$/u.test(ctx.body)) {
        const mutes = listActiveMutes();
        if (mutes.length === 0) {
          await ctx.sendText(ctx.actorChatId, formatNoMutesToClear());
          return "handled";
        }
        if (mutes.length === 1) {
          const only = mutes[0]!;
          unmuteChat(only.chatId);
          await ctx.notifyAllMaintainers(
            formatMaintainerActionBroadcast(
              ctx.operatorName,
              `已恢复对「${only.chatName}」的自动回复。`,
            ),
          );
          return "handled";
        }
        saveMaintainerPending({
          action: "pick_unmute",
          candidates: mutes.map((m) => ({
            chatId: m.chatId,
            chatName: m.chatName,
          })),
        });
        await ctx.sendText(
          ctx.actorChatId,
          formatUnmutePickPrompt(mutes.length),
        );
        return "handled";
      }

      const activeMutes = listActiveMutes();
      if (activeMutes.length > 0) {
        await ctx.sendText(
          ctx.actorChatId,
          formatMaintainerBlockedChat(activeMutes.length),
        );
        return "blocked";
      }

      return undefined;
    },
  };
}
