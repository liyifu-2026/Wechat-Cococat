import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";

const prevConfig = process.env.COCOCAT_CONFIG_DIR;
const prevData = process.env.COCOCAT_DATA_DIR;

afterEach(() => {
  if (prevConfig === undefined) delete process.env.COCOCAT_CONFIG_DIR;
  else process.env.COCOCAT_CONFIG_DIR = prevConfig;
  if (prevData === undefined) delete process.env.COCOCAT_DATA_DIR;
  else process.env.COCOCAT_DATA_DIR = prevData;
});

function writeEscalation(
  configDir: string,
  maintainer: { chatId: string; displayName: string },
  maintainers?: { chatId: string; displayName: string }[],
): void {
  writeFileSync(
    join(configDir, "escalation.json"),
    JSON.stringify(
      {
        maintainers: maintainers ?? [maintainer],
        maintainer,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
}

async function loadConfigModule() {
  return import("./config.js");
}

async function loadServiceModule() {
  return import("./service.js");
}

async function loadStateStore() {
  return import("./state-store.js");
}

describe("escalation config hot reload", () => {
  test("loadEscalationConfigCached reuses cache when file unchanged", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "cococat-esc-cfg-"));
    process.env.COCOCAT_CONFIG_DIR = configDir;
    writeEscalation(configDir, { chatId: "wxid_a", displayName: "A" });

    const { loadEscalationConfigCached, clearEscalationConfigCache } =
      await loadConfigModule();
    clearEscalationConfigCache();

    const first = loadEscalationConfigCached();
    const second = loadEscalationConfigCached();
    assert.equal(first.maintainers.length, 1);
    assert.equal(first.maintainerChatId, "wxid_a");
    assert.equal(second.maintainerChatId, "wxid_a");
  });

  test("loadEscalationConfigCached picks up maintainer change after file rewrite", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "cococat-esc-cfg-"));
    process.env.COCOCAT_CONFIG_DIR = configDir;
    writeEscalation(configDir, { chatId: "wxid_a", displayName: "A" });

    const { loadEscalationConfigCached, clearEscalationConfigCache } =
      await loadConfigModule();
    clearEscalationConfigCache();

    assert.equal(loadEscalationConfigCached().maintainerChatId, "wxid_a");

    writeEscalation(configDir, { chatId: "wxid_b", displayName: "B" });
    assert.equal(loadEscalationConfigCached().maintainerChatId, "wxid_b");
  });

  test("EscalationService clears maintainer pending when maintainer switches", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "cococat-esc-cfg-"));
    const dataDir = mkdtempSync(join(tmpdir(), "cococat-esc-data-"));
    process.env.COCOCAT_CONFIG_DIR = configDir;
    process.env.COCOCAT_DATA_DIR = dataDir;
    mkdirSync(join(dataDir, "escalation"), { recursive: true });
    writeEscalation(configDir, { chatId: "wxid_a", displayName: "A" });

    const { clearEscalationConfigCache } = await loadConfigModule();
    clearEscalationConfigCache();

    const { saveMaintainerPending, loadMaintainerPending } =
      await loadStateStore();
    saveMaintainerPending({
      action: "pick_unmute",
      candidates: [{ chatId: "wxid_c", chatName: "客户C" }],
    });
    assert.ok(loadMaintainerPending());

    const { EscalationService } = await loadServiceModule();
    const service = new EscalationService({
      findChats: async () => [],
      sendMessage: async () => {},
    } as never);

    assert.equal(service.isMaintainerChat("wxid_a"), true);

    writeEscalation(configDir, { chatId: "wxid_b", displayName: "B" });

    assert.equal(service.isMaintainerChat("wxid_b"), true);
    assert.equal(service.isMaintainerChat("wxid_a"), false);
    assert.equal(loadMaintainerPending(), null);
  });

  test("isMaintainerChat accepts multiple maintainers", async () => {
    const configDir = mkdtempSync(join(tmpdir(), "cococat-esc-cfg-"));
    process.env.COCOCAT_CONFIG_DIR = configDir;
    writeEscalation(
      configDir,
      { chatId: "wxid_a", displayName: "A" },
      [
        { chatId: "wxid_a", displayName: "A" },
        { chatId: "wxid_b", displayName: "B" },
      ],
    );

    const { clearEscalationConfigCache } = await loadConfigModule();
    clearEscalationConfigCache();

    const { EscalationService } = await loadServiceModule();
    const service = new EscalationService({
      findChats: async () => [],
      sendMessage: async () => {},
    } as never);

    assert.equal(service.isMaintainerChat("wxid_a"), true);
    assert.equal(service.isMaintainerChat("wxid_b"), true);
    assert.equal(service.isMaintainerChat("wxid_c"), false);
  });
});
