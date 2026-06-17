import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import type { EscalationConfig } from "./types.js";

const prevData = process.env.COCOCAT_DATA_DIR;

afterEach(() => {
  if (prevData === undefined) delete process.env.COCOCAT_DATA_DIR;
  else process.env.COCOCAT_DATA_DIR = prevData;
});

function baseConfig(): EscalationConfig {
  return {
    enabled: true,
    maintainerChatId: "wxid_maintainer",
    maintainerDisplayName: "维护者",
    maintainers: [{ chatId: "wxid_maintainer", displayName: "维护者" }],
    notifyEscalate: true,
    notifyProbeLoop: true,
    notifyLowConfidence: false,
    triageUseLlm: false,
    lowConfidenceThreshold: 0.45,
    deflectLine: "deflect-line-should-not-send",
    customerLine: "customer-line-should-not-send",
    muteHoursEscalate: 24,
    muteHoursProbeLoop: 2,
    probeStreakThreshold: 2,
    agentHandoffEnabled: true,
  };
}

type ServiceInternals = {
  applyExecutedGate: (p: {
    chatId: string;
    chatName: string;
    executed: string;
    reason: string;
    confidence: number;
    userLines: string[];
  }) => Promise<{ status: string }>;
};

describe("EscalationService customer silent", () => {
  test("SEND_DEFLECT_LINE does not message customer", async () => {
    const sent: { chatId: string; text: string }[] = [];
    const { EscalationService } = await import("./service.js");
    const service = new EscalationService(
      {
        findChats: async () => [],
        sendMessage: async (msg: { chatId: string; text: string }) => {
          sent.push(msg);
        },
      } as never,
      baseConfig(),
    );

    const outcome = await (service as unknown as ServiceInternals).applyExecutedGate({
      chatId: "wxid_customer",
      chatName: "客户A",
      executed: "SEND_DEFLECT_LINE",
      reason: "probe@fallback",
      confidence: 0.5,
      userLines: ["你是不是机器人"],
    });

    assert.equal(outcome.status, "done");
    assert.equal(sent.length, 0);
  });

  test("HANDOFF_ESCALATE and agent handoff notify maintainer only", async () => {
    const dataDir = mkdtempSync(join(tmpdir(), "cococat-esc-silent-"));
    process.env.COCOCAT_DATA_DIR = dataDir;
    mkdirSync(join(dataDir, "escalation"), { recursive: true });

    const sent: { chatId: string; text: string }[] = [];
    const { EscalationService } = await import("./service.js");
    const service = new EscalationService(
      {
        findChats: async () => [],
        sendMessage: async (msg: { chatId: string; text: string }) => {
          sent.push(msg);
        },
      } as never,
      baseConfig(),
    );

    await (service as unknown as ServiceInternals).applyExecutedGate({
      chatId: "wxid_customer",
      chatName: "客户B",
      executed: "HANDOFF_ESCALATE",
      reason: "complaint@llm",
      confidence: 0.9,
      userLines: ["我要投诉"],
    });

    await service.applyAgentHandoff({
      chatId: "wxid_customer2",
      chatName: "客户C",
      summary: "502 需工程介入",
      reason: "technical",
      userLines: ["502"],
    });

    const customerMsgs = sent.filter(
      (m) => m.chatId === "wxid_customer" || m.chatId === "wxid_customer2",
    );
    assert.equal(customerMsgs.length, 0);

    const maintainerMsgs = sent.filter((m) => m.chatId === "wxid_maintainer");
    assert.ok(maintainerMsgs.length >= 2);
    for (const msg of maintainerMsgs) {
      assert.match(msg.text, /客户侧静默/);
    }
  });
});
