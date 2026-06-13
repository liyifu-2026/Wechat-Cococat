import type { NewMessagesChatInfo, WeChatClient } from "@cococat/shared";
import type { PiWeChatConfig } from "./config.js";
import { EscalationService } from "./escalation/service.js";
import { enqueueChatInbound } from "./queue/enqueue.js";
import { isQueueEnabled } from "./queue/redis.js";
import { startQueueWorkers, stopQueueWorkers } from "./queue/worker.js";
import { SessionManager } from "./session.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function handleChats(
  client: WeChatClient,
  manager: SessionManager,
  chats: NewMessagesChatInfo[],
): Promise<void> {
  for (const chat of chats) {
    if (!chat.chatId) continue;
    try {
      if (manager.isMaintainerChat(chat.chatId)) {
        if (isQueueEnabled()) {
          await enqueueChatInbound(client, chat);
        } else {
          await manager.processMaintainer(chat.chatId);
        }
        continue;
      }

      if (isQueueEnabled()) {
        await enqueueChatInbound(client, chat);
      } else {
        await manager.get(chat.chatId).process(chat.name, chat.isGroup);
      }
    } catch (err) {
      console.error(`[pi-wechat] ${chat.name}:`, err);
    }
  }
}

async function pollFallback(
  client: WeChatClient,
  manager: SessionManager,
): Promise<void> {
  const chats = await client.listChats(50);
  const active = chats.filter((c) => (c.unreadCount ?? 0) > 0);
  await handleChats(
    client,
    manager,
    active.map((c) => ({
      chatId: c.id,
      name: c.name,
      unreadCount: c.unreadCount ?? 0,
      isGroup: c.isGroup ?? false,
    })),
  );
}

export async function runWeChatMonitor(
  client: WeChatClient,
  config: PiWeChatConfig,
): Promise<{ stop: () => void }> {
  const escalation = new EscalationService(client);
  if (escalation.isEnabled()) {
    console.log(
      `[pi-wechat] escalation enabled (maintainer=${escalation.config.maintainerChatId || escalation.config.maintainerDisplayName})`,
    );
  }
  const manager = new SessionManager(client, config, escalation);

  if (isQueueEnabled()) {
    await startQueueWorkers(client, config, manager);
    console.log("[pi-wechat] message queue enabled (BullMQ + Redis)");
  } else {
    console.log("[pi-wechat] message queue disabled — sync process path");
  }

  let stopped = false;
  let wsHandle: { close: () => void } | undefined;

  const connect = () => {
    if (stopped) return;
    wsHandle?.close();
    wsHandle = client.eventsSubscribe({
      onEvent: (event) => {
        void handleChats(client, manager, event.chats);
      },
      onError: (err) => {
        console.error("[pi-wechat] events ws error:", err.message);
      },
      onClose: () => {
        if (stopped) return;
        console.warn("[pi-wechat] events ws closed — reconnecting in 2s");
        setTimeout(connect, 2000);
      },
    });
  };

  connect();

  const pollLoop = async () => {
    while (!stopped) {
      await sleep(config.pollFallbackMs);
      if (stopped) break;
      try {
        await pollFallback(client, manager);
      } catch (err) {
        console.error("[pi-wechat] poll fallback:", err);
      }
    }
  };

  void pollLoop();

  return {
    stop: () => {
      stopped = true;
      wsHandle?.close();
      if (isQueueEnabled()) {
        void stopQueueWorkers();
      }
    },
  };
}
