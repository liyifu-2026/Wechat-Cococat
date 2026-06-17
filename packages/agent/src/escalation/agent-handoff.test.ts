import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  AGENT_HANDOFF_PROMPT,
  createAgentHandoffTools,
  type AgentHandoffTurnRef,
} from "./agent-handoff.js";
import type { EscalationService } from "./service.js";

describe("agent handoff", () => {
  it("prompt mentions wiki search prerequisite", () => {
    assert.match(AGENT_HANDOFF_PROMPT, /wiki_search/);
    assert.match(AGENT_HANDOFF_PROMPT, /request_human_handoff/);
  });

  it("tool invokes applyAgentHandoff and marks turn done", async () => {
    const calls: unknown[] = [];
    const service = {
      applyAgentHandoff: async (p: unknown) => {
        calls.push(p);
      },
    } as unknown as EscalationService;

    const turnRef: AgentHandoffTurnRef = {
      chatName: "测试客户",
      userLines: ["502 一直报错"],
      done: false,
    };
    const [tool] = createAgentHandoffTools(service, "wxid_test", turnRef);
    const result = await tool.execute!("id", {
      summary: "后台 502，已查 wiki 无结果，需工程师看日志",
      reason: "technical",
    });

    assert.equal(calls.length, 1);
    assert.equal(turnRef.done, true);
    assert.match(
      (result as { content: Array<{ text: string }> }).content[0]!.text,
      /已转同事跟进/,
    );
  });

  it("tool rejects empty summary", async () => {
    const service = {
      applyAgentHandoff: async () => {},
    } as unknown as EscalationService;
    const turnRef: AgentHandoffTurnRef = {
      chatName: "x",
      userLines: [],
      done: false,
    };
    const [tool] = createAgentHandoffTools(service, "wxid_x", turnRef);
    const result = await tool.execute!("id", { summary: "  " });
    assert.equal(turnRef.done, false);
    assert.match(
      (result as { content: Array<{ text: string }> }).content[0]!.text,
      /不能为空/,
    );
  });
});
