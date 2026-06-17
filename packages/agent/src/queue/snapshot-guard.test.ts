import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { ensureChatContext } from "../chat-store.js";
import {
  filterUnseenLocalIds,
  markSeenLocalIds,
} from "./snapshot-guard.js";

const chatId = "wxuser@test";
let dataRoot = "";

afterEach(() => {
  if (dataRoot) {
    rmSync(dataRoot, { recursive: true, force: true });
    dataRoot = "";
  }
  delete process.env.COCOCAT_DATA_DIR;
});

function setupChatDir(): void {
  dataRoot = mkdtempSync(join(tmpdir(), "snapshot-guard-"));
  process.env.COCOCAT_DATA_DIR = dataRoot;
  ensureChatContext(chatId);
}

describe("filterUnseenLocalIds", () => {
  it("drops localIds already in seen store", () => {
    setupChatDir();
    markSeenLocalIds(chatId, [10, 11]);
    assert.deepEqual(filterUnseenLocalIds(chatId, [10, 12]), [12]);
  });

  it("returns empty when all ids are seen", () => {
    setupChatDir();
    markSeenLocalIds(chatId, [5]);
    assert.deepEqual(filterUnseenLocalIds(chatId, [5]), []);
  });
});
