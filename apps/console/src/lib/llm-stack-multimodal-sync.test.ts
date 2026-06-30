import { describe, it, expect } from "vitest";
import { defaultLlmStack } from "@cococat/shared/llm-stack";
import { multimodalConfigFromWikiIngestRole } from "./llm-stack-multimodal-sync";
import type { LlmConfig } from "@/stores/wiki-store";

const fallback: LlmConfig = {
  provider: "custom",
  apiKey: "",
  model: "mimo-v2.5-pro",
  ollamaUrl: "http://localhost:11434",
  customEndpoint: "",
  maxContextSize: 128_000,
  apiMode: "chat_completions",
};

describe("multimodalConfigFromWikiIngestRole", () => {
  it("inherit with vision override uses chat provider and omni model", () => {
    const stack = defaultLlmStack("xiaomi-mimo", "mimo-v2.5-pro");
    const mm = multimodalConfigFromWikiIngestRole(stack, {}, fallback);
    expect(mm.enabled).toBe(true);
    expect(mm.useMainLlm).toBe(false);
    expect(mm.model).toBe("mimo-v2-omni");
  });

  it("inherit without override uses main llm", () => {
    const stack = defaultLlmStack("xiaomi-mimo", "mimo-v2-omni");
    const omniFallback = { ...fallback, model: "mimo-v2-omni" };
    const mm = multimodalConfigFromWikiIngestRole(stack, {}, omniFallback);
    expect(mm.enabled).toBe(true);
    expect(mm.useMainLlm).toBe(true);
    expect(mm.model).toBe("mimo-v2-omni");
  });

  it("inherit override materializes xiaomi wiki ingest caption config", () => {
    const stack = defaultLlmStack("xiaomi-mimo", "mimo-v2-omni");
    stack.roles.wikiIngestCaption = {
      mode: "inherit",
      inheritFrom: "chat",
      modelOverride: "mimo-v2.5",
      enabled: true,
    };

    const mm = multimodalConfigFromWikiIngestRole(
      stack,
      {
        "xiaomi-mimo": {
          apiKey: "test-key",
          baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
        },
      },
      fallback,
    );

    expect(mm.enabled).toBe(true);
    expect(mm.useMainLlm).toBe(false);
    expect(mm.provider).toBe("custom");
    expect(mm.model).toBe("mimo-v2.5");
    expect(mm.apiKey).toBe("test-key");
    expect(mm.customEndpoint).toBe("https://token-plan-cn.xiaomimimo.com/v1");
  });

  it("custom wiki ingest maps dedicated endpoint", () => {
    const stack = defaultLlmStack("xiaomi-mimo", "mimo-v2.5-pro");
    stack.roles.wikiIngestCaption = {
      mode: "custom",
      providerId: "xiaomi-mimo",
      model: "mimo-v2-omni",
    };
    const mm = multimodalConfigFromWikiIngestRole(
      stack,
      {
        "xiaomi-mimo": {
          apiKey: "test-key",
          baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
        },
      },
      fallback,
    );
    expect(mm.enabled).toBe(true);
    expect(mm.useMainLlm).toBe(false);
    expect(mm.model).toBe("mimo-v2-omni");
    expect(mm.apiKey).toBe("test-key");
    expect(mm.customEndpoint).toMatch(/xiaomimimo/);
  });

  it("disabled binding turns off ingest caption", () => {
    const stack = defaultLlmStack("xiaomi-mimo", "mimo-v2.5-pro");
    stack.roles.wikiIngestCaption = {
      mode: "inherit",
      inheritFrom: "chat",
      enabled: false,
    };
    const mm = multimodalConfigFromWikiIngestRole(stack, {}, fallback);
    expect(mm.enabled).toBe(false);
  });

  it("turns off ingest caption when the resolved model has no vision", () => {
    const stack = defaultLlmStack("deepseek", "deepseek-chat");
    stack.roles.wikiIngestCaption = {
      mode: "inherit",
      inheritFrom: "chat",
      enabled: true,
    };
    const mm = multimodalConfigFromWikiIngestRole(stack, {}, {
      ...fallback,
      model: "deepseek-chat",
    });
    expect(mm.enabled).toBe(false);
  });

  it("uses stack wikiIngestConcurrency", () => {
    const stack = defaultLlmStack("xiaomi-mimo", "mimo-v2.5-pro");
    stack.wikiIngestConcurrency = 8;
    const mm = multimodalConfigFromWikiIngestRole(stack, {}, fallback);
    expect(mm.concurrency).toBe(8);
  });

  it("falls back to previous config when stack omits wikiIngestConcurrency", () => {
    const stack = defaultLlmStack("xiaomi-mimo", "mimo-v2.5-pro");
    stack.wikiIngestConcurrency = undefined;
    const mm = multimodalConfigFromWikiIngestRole(stack, {}, fallback, {
      enabled: true,
      useMainLlm: true,
      provider: "custom",
      apiKey: "",
      model: "x",
      ollamaUrl: "",
      customEndpoint: "",
      concurrency: 8,
    });
    expect(mm.concurrency).toBe(8);
  });
});
