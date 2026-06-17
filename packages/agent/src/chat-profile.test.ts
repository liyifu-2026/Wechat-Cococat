import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { encodeChatDir } from "@cococat/shared";

const prevData = process.env.COCOCAT_DATA_DIR;
const prevConfig = process.env.COCOCAT_CONFIG_DIR;

beforeEach(() => {
  process.env.COCOCAT_DATA_DIR = mkdtempSync(join(tmpdir(), "chat-prof-"));
  process.env.COCOCAT_CONFIG_DIR = mkdtempSync(join(tmpdir(), "chat-cfg-"));
});

afterEach(() => {
  if (prevData === undefined) delete process.env.COCOCAT_DATA_DIR;
  else process.env.COCOCAT_DATA_DIR = prevData;
  if (prevConfig === undefined) delete process.env.COCOCAT_CONFIG_DIR;
  else process.env.COCOCAT_CONFIG_DIR = prevConfig;
});

async function loadModules() {
  const profile = await import("./chat-profile.js");
  const prompt = await import("./customer-context-prompt.js");
  const types = await import("./customer-types/config.js");
  return { profile, prompt, types };
}

describe("normalizeProfileTags", () => {
  test("dedupes and caps at MAX_PROFILE_TAGS", async () => {
    const { profile } = await loadModules();
    assert.deepEqual(
      profile.normalizeProfileTags([
        "a",
        " a ",
        "b",
        "c",
        "d",
        "e",
        "f",
      ]),
      ["a", "b", "c", "d", "e"],
    );
  });
});

describe("patchContactTags preserves userType", () => {
  test("replaces tags without touching userType", async () => {
    const { profile } = await loadModules();
    const chatId = "wxid_test_user";
    const dir = join(
      process.env.COCOCAT_DATA_DIR!,
      "chats",
      encodeChatDir(chatId),
    );
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "profile.json"),
      JSON.stringify({ tags: ["old"], userType: "vip" }, null, 2),
    );

    const next = await profile.patchContactTags(chatId, ["新标签", "新标签"]);
    assert.deepEqual(next.tags, ["新标签"]);
    assert.equal(next.userType, "vip");

    const reloaded = profile.loadChatProfile(chatId);
    assert.equal(reloaded.userType, "vip");
    assert.deepEqual(reloaded.tags, ["新标签"]);
  });
});

describe("resolveCustomerContextPrompt", () => {
  test("includes behavior guide from customer-types.json", async () => {
    const { profile, prompt, types } = await loadModules();
    types.clearCustomerTypesConfigCache();
    writeFileSync(
      types.customerTypesConfigPath(),
      JSON.stringify(
        {
          types: [
            {
              id: "vip",
              label: "VIP 客户",
              behaviorGuide: "语气热情，3 轮未解决考虑升级。",
              sortOrder: 0,
            },
          ],
        },
        null,
        2,
      ),
    );

    const chatId = "wxid_vip_user";
    const dir = join(
      process.env.COCOCAT_DATA_DIR!,
      "chats",
      encodeChatDir(chatId),
    );
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "profile.json"),
      JSON.stringify({ userType: "vip", tags: ["关注发票"] }, null, 2),
    );

    const block = prompt.resolveCustomerContextPrompt(chatId);
    assert.match(block, /VIP 客户/);
    assert.match(block, /语气热情/);
    assert.match(block, /关注发票/);
    assert.equal(profile.loadChatProfile(chatId).userType, "vip");
  });

  test("empty when no userType", async () => {
    const { prompt } = await loadModules();
    assert.equal(prompt.resolveCustomerContextPrompt("wxid_none"), "");
  });
});
