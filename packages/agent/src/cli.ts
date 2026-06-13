#!/usr/bin/env node
import { WeChatClient } from "@cococat/shared";
import { loadConfig } from "./config.js";
import { runWeChatMonitor } from "./monitor.js";
import {
  reconcileAllTranscripts,
  reconcileTranscriptForChat,
} from "./reconcile-transcript.js";
import { runWikiScopeRefreshCli } from "./wiki-scope-refresh.js";

async function runReconcile(argv: string[]): Promise<void> {
  const config = loadConfig();
  const client = new WeChatClient({
    baseUrl: config.serverUrl,
    token: config.token,
  });

  const allFlag = argv.includes("--all");
  const chatId = argv.find((a) => !a.startsWith("-"));

  if (allFlag) {
    await reconcileAllTranscripts(client, config.historyLimit);
    return;
  }

  if (!chatId) {
    console.error(
      "用法: cococat-agent reconcile-transcript <chatId>\n       cococat-agent reconcile-transcript --all",
    );
    process.exit(1);
  }

  await reconcileTranscriptForChat(client, chatId, config.historyLimit);
}

async function runMonitor(): Promise<void> {
  const config = loadConfig();
  const client = new WeChatClient({
    baseUrl: config.serverUrl,
    token: config.token,
  });

  const auth = await client.authStatus();
  console.log(
    `[pi-wechat] connected to ${config.serverUrl} — WeChat: ${auth.status}`,
  );
  if (auth.status !== "logged_in") {
    console.warn(
      "[pi-wechat] WeChat not logged in. Log in via wx CLI or VNC first.",
    );
  }

  console.log(
    `[pi-wechat] model ${config.provider}/${config.model} — listening for messages`,
  );
  console.log(
    `[pi-wechat] group policy: require_mention=${config.group.defaultPolicy.requireMention}, reply_with_mention=${config.group.defaultPolicy.replyWithMention}`,
  );
  console.log(
    `[pi-wechat] queue: ${config.queueEnabled ? "enabled" : "disabled (sync)"}`,
  );

  if (config.wikiEnabled && config.wikiClient) {
    await config.wikiClient.syncRegistry();
    const ok = await config.wikiClient.checkHealth();
    console.log(
      `[pi-wechat] wiki ${ok ? "connected" : "unreachable"} at ${process.env.WIKI_API_URL ?? "http://127.0.0.1:19828"}`,
    );
    if (!ok) {
      console.warn("[pi-wechat] WIKI_ENABLED but llm_wiki API not reachable");
    }
  }

  await config.memoryHealth.assertHealthyAtStartup();
  console.log(
    `[pi-wechat] memory connected at ${config.memoryClient.url}`,
  );

  const handle = await runWeChatMonitor(client, config);

  const shutdown = () => {
    console.log("\n[pi-wechat] shutting down");
    handle.stop();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;

  if (command === "reconcile-transcript") {
    await runReconcile(rest);
    return;
  }

  if (command === "wiki-scope-refresh") {
    const code = await runWikiScopeRefreshCli(rest);
    process.exit(code);
  }

  await runMonitor();
}

main().catch((err) => {
  console.error("[pi-wechat] fatal:", err);
  process.exit(1);
});
