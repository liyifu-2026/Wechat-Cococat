#!/usr/bin/env node
/**
 * Console Brain preview — delegates to @cococat/agent previewCustomerReply.
 * Usage: node scripts/preview-agent-reply.mjs "<query>" [chatId]
 * stdout: JSON PreviewReplyResult (camelCase)
 */
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const query = process.argv[2];
const chatId = process.argv[3]?.trim() || undefined;

if (!query?.trim()) {
  console.error("usage: preview-agent-reply.mjs <query> [chatId]");
  process.exit(1);
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const agentEntry = join(repoRoot, "packages/agent/dist/index.js");

const { previewCustomerReply } = await import(agentEntry);

const result = await previewCustomerReply({
  query: query.trim(),
  chatId,
});

console.log(
  JSON.stringify({
    action: result.action,
    reason: result.reason,
    answer: result.answer,
    stealthOk: result.stealthOk,
    bannedHits: result.bannedHits,
    confidence: result.confidence,
    source: result.source,
  }),
);
