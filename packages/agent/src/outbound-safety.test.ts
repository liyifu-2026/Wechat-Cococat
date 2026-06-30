import test from "node:test";
import assert from "node:assert/strict";
import type { WeChatClient } from "@cococat/shared";
import {
  resetOutboundSafetyForTest,
  sendWeChatSafely,
} from "./outbound-safety.js";

function mockClient(success = true): WeChatClient {
  return {
    sendMessage: async () => ({ success }),
  } as unknown as WeChatClient;
}

function resetEnv(): void {
  delete process.env.COCOCAT_OUTBOUND_SAFETY;
  delete process.env.COCOCAT_OUTBOUND_MIN_CHAT_INTERVAL_MS;
  delete process.env.COCOCAT_OUTBOUND_MIN_GLOBAL_INTERVAL_MS;
  delete process.env.COCOCAT_OUTBOUND_MAX_PER_CHAT;
  delete process.env.COCOCAT_OUTBOUND_MAX_GLOBAL;
  delete process.env.COCOCAT_OUTBOUND_MAX_AUTO_DELAY_MS;
  delete process.env.COCOCAT_OUTBOUND_COOLDOWN_MS;
}

test.afterEach(() => {
  resetEnv();
  resetOutboundSafetyForTest();
});

test("sendWeChatSafely throws on driver send failure", async () => {
  resetEnv();
  process.env.COCOCAT_OUTBOUND_MIN_CHAT_INTERVAL_MS = "0";
  process.env.COCOCAT_OUTBOUND_MIN_GLOBAL_INTERVAL_MS = "0";

  await assert.rejects(
    () => sendWeChatSafely(mockClient(false), { chatId: "c1", text: "hi" }),
    /\[wechat-send\]/,
  );
});

test("sendWeChatSafely delays rapid repeated sends instead of cooling down", async () => {
  resetEnv();
  process.env.COCOCAT_OUTBOUND_MIN_CHAT_INTERVAL_MS = "5";
  process.env.COCOCAT_OUTBOUND_MIN_GLOBAL_INTERVAL_MS = "0";
  process.env.COCOCAT_OUTBOUND_COOLDOWN_MS = "0";

  let sends = 0;
  const client = mockClient();
  client.sendMessage = async () => {
    sends += 1;
    return { success: true };
  };

  await sendWeChatSafely(client, { chatId: "c1", text: "first" });
  await sendWeChatSafely(client, { chatId: "c1", text: "second" });

  assert.equal(sends, 2);
});

test("sendWeChatSafely blocks when the needed delay is too long", async () => {
  resetEnv();
  process.env.COCOCAT_OUTBOUND_MIN_CHAT_INTERVAL_MS = "60000";
  process.env.COCOCAT_OUTBOUND_MIN_GLOBAL_INTERVAL_MS = "0";
  process.env.COCOCAT_OUTBOUND_MAX_AUTO_DELAY_MS = "1";
  process.env.COCOCAT_OUTBOUND_COOLDOWN_MS = "0";

  const client = mockClient();
  await sendWeChatSafely(client, { chatId: "c1", text: "first" });

  await assert.rejects(
    () => sendWeChatSafely(client, { chatId: "c1", text: "second" }),
    /required delay/,
  );
});

test("sendWeChatSafely can be explicitly disabled", async () => {
  resetEnv();
  process.env.COCOCAT_OUTBOUND_SAFETY = "off";
  process.env.COCOCAT_OUTBOUND_MIN_CHAT_INTERVAL_MS = "60000";

  const client = mockClient();
  await sendWeChatSafely(client, { chatId: "c1", text: "first" });
  await sendWeChatSafely(client, { chatId: "c1", text: "second" });
});

test("sendWeChatSafely serializes concurrent sends through one safety gate", async () => {
  resetEnv();
  process.env.COCOCAT_OUTBOUND_MIN_CHAT_INTERVAL_MS = "20";
  process.env.COCOCAT_OUTBOUND_MIN_GLOBAL_INTERVAL_MS = "0";

  const starts: number[] = [];
  const client = mockClient();
  client.sendMessage = async () => {
    starts.push(Date.now());
    return { success: true };
  };

  await Promise.all([
    sendWeChatSafely(client, { chatId: "c1", text: "first" }),
    sendWeChatSafely(client, { chatId: "c1", text: "second" }),
  ]);

  assert.equal(starts.length, 2);
  assert.ok(
    starts[1]! - starts[0]! >= 15,
    `expected serialized delay, got ${starts[1]! - starts[0]!}ms`,
  );
});
