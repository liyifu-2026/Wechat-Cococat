import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { loadConfig } from "./config.js";
import { resolveGroupConfig } from "./effective-config.js";
import { policyFor } from "./group-config.js";
import { createMemoryClient } from "./memory-client.js";
import { encodeChatDir } from "./paths.js";

const ENV_KEYS = [
  "AGENT_WECHAT_TOKEN",
  "AGENT_WECHAT_URL",
  "WIKI_ENABLED",
  "WIKI_API_URL",
  "BRIDGE_REQUIRE_MENTION",
  "BRIDGE_REPLY_WITH_MENTION",
  "TDAI_MEMORY_ENABLED",
  "TDAI_GATEWAY_URL",
] as const;

const savedEnv = new Map<string, string | undefined>();

function snapshotEnv() {
  savedEnv.clear();
  for (const key of ENV_KEYS) {
    savedEnv.set(key, process.env[key]);
  }
}

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("agent smoke", () => {
  beforeEach(() => snapshotEnv());
  afterEach(() => restoreEnv());

  test("encodeChatDir encodes WeChat chatroom ids", () => {
    assert.equal(encodeChatDir("12345678@chatroom"), "_12345678_chatroom");
    assert.equal(encodeChatDir("wxid_abc"), "_wxid_abc");
  });

  test("resolveGroupConfig applies default mention policy", () => {
    delete process.env.BRIDGE_REQUIRE_MENTION;
    delete process.env.BRIDGE_REPLY_WITH_MENTION;
    delete process.env.BRIDGE_GROUPS_CONFIG;

    const config = resolveGroupConfig();
    assert.equal(config.defaultPolicy.requireMention, true);
    assert.equal(config.defaultPolicy.replyWithMention, "none");
    assert.equal(config.groupHistoryLimit, 50);
  });

  test('resolveGroupConfig treats JSON string "none" as none not trigger', () => {
    const dir = mkdtempSync(join(tmpdir(), "bridge-groups-"));
    const path = join(dir, "bridge-groups.json");
    writeFileSync(
      path,
      JSON.stringify({
        "*": { require_mention: true, reply_with_mention: "none" },
      }),
    );
    process.env.BRIDGE_GROUPS_CONFIG = path;
    delete process.env.BRIDGE_REPLY_WITH_MENTION;

    const config = resolveGroupConfig();
    assert.equal(config.defaultPolicy.replyWithMention, "none");
  });

  test("policyFor falls back to default policy for unknown chats", () => {
    const config = resolveGroupConfig();
    const policy = policyFor(config, "missing@chatroom");
    assert.deepEqual(policy, config.defaultPolicy);
  });

  test("loadConfig reads token and driver URL from env", () => {
    process.env.AGENT_WECHAT_TOKEN = "ci-smoke-token";
    process.env.AGENT_WECHAT_URL = "http://127.0.0.1:6174";
    delete process.env.WIKI_ENABLED;

    const config = loadConfig();
    assert.equal(config.token, "ci-smoke-token");
    assert.equal(config.serverUrl, "http://127.0.0.1:6174");
    assert.equal(config.wikiEnabled, false);
    assert.equal(config.wikiClient, undefined);
    assert.equal(config.provider, "anthropic");
  });

  test("loadConfig wires wiki client when WIKI_ENABLED=1", () => {
    process.env.AGENT_WECHAT_TOKEN = "ci-smoke-token";
    process.env.WIKI_ENABLED = "1";
    process.env.WIKI_API_URL = "http://127.0.0.1:19828";

    const config = loadConfig();
    assert.equal(config.wikiEnabled, true);
    assert.ok(config.wikiClient);
  });

  test("createMemoryClient throws when TDAI_MEMORY_ENABLED=false", () => {
    process.env.TDAI_MEMORY_ENABLED = "false";
    assert.throws(() => createMemoryClient(), /required infrastructure/);
  });

  test("createMemoryClient uses default gateway URL", () => {
    delete process.env.TDAI_MEMORY_ENABLED;
    delete process.env.TDAI_GATEWAY_URL;

    const client = createMemoryClient();
    assert.ok(client);
    assert.equal(client.url, "http://127.0.0.1:8420");
  });
});
