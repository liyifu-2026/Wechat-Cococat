import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";

const prevData = process.env.COCOCAT_DATA_DIR;

afterEach(() => {
  if (prevData === undefined) delete process.env.COCOCAT_DATA_DIR;
  else process.env.COCOCAT_DATA_DIR = prevData;
});

async function loadStateStore() {
  return import("../escalation/state-store.js");
}

describe("maintainer pending TTL", () => {
  test("pick_memory expires after TTL", async () => {
    const root = mkdtempSync(join(tmpdir(), "cococat-pending-"));
    process.env.COCOCAT_DATA_DIR = root;
    mkdirSync(join(root, "escalation"), { recursive: true });

    const { saveMaintainerPending, loadMaintainerPending } =
      await loadStateStore();

    saveMaintainerPending({
      action: "pick_memory",
      query: "张三",
      candidates: [
        {
          chatId: "wxid_a",
          chatName: "张三",
          muteLabel: "自动回复中",
          profileTags: [],
        },
      ],
      expiresAt: Date.now() - 1,
    });

    assert.equal(loadMaintainerPending(), null);
  });

  test("pick_memory still valid before expiry", async () => {
    const root = mkdtempSync(join(tmpdir(), "cococat-pending-"));
    process.env.COCOCAT_DATA_DIR = root;
    mkdirSync(join(root, "escalation"), { recursive: true });

    const {
      saveMaintainerPending,
      loadMaintainerPending,
      maintainerMemoryPickTtlMs,
    } = await loadStateStore();

    saveMaintainerPending({
      action: "pick_memory",
      query: "张三",
      candidates: [
        {
          chatId: "wxid_a",
          chatName: "张三",
          muteLabel: "自动回复中",
          profileTags: [],
        },
      ],
      expiresAt: Date.now() + maintainerMemoryPickTtlMs(),
    });

    const pending = loadMaintainerPending();
    assert.equal(pending?.action, "pick_memory");
  });

  test("new pending overwrites previous action", async () => {
    const root = mkdtempSync(join(tmpdir(), "cococat-pending-"));
    process.env.COCOCAT_DATA_DIR = root;
    mkdirSync(join(root, "escalation"), { recursive: true });

    const { saveMaintainerPending, loadMaintainerPending } =
      await loadStateStore();

    saveMaintainerPending({
      action: "pick_unmute",
      candidates: [{ chatId: "wxid_x", chatName: "X" }],
    });
    saveMaintainerPending({
      action: "pick_memory",
      query: "Y",
      candidates: [
        {
          chatId: "wxid_y",
          chatName: "Y",
          muteLabel: "自动回复中",
          profileTags: [],
        },
      ],
      expiresAt: Date.now() + 10 * 60 * 1000,
    });

    assert.equal(loadMaintainerPending()?.action, "pick_memory");
  });
});
