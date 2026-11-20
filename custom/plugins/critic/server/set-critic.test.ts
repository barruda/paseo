import { describe, expect, test } from "vitest";
import {
  CRITIC_ENABLED_LABEL,
  CRITIC_ROLE_LABEL,
  CRITIC_ROLE_VALUE,
  DEFAULT_CRITIC_CONFIG,
  type CriticConfig,
} from "@getpaseo/protocol/critic";
import type { AgentToolContext, PluginServerContext } from "@getpaseo/plugin/server";
import contribute from "../index.server";
import { applySetCriticInput, criticEnabledLabel, splitCriticModel } from "../shared/set-config";
import { createSetCriticTool, shouldAttachCriticTool } from "./set-critic";

function fakeStore(initial: CriticConfig = DEFAULT_CRITIC_CONFIG) {
  const state = { config: initial };
  const writes: Array<{ agentId: string; config: CriticConfig; saveAsDefault: boolean }> = [];
  return {
    state,
    writes,
    store: {
      async get() {
        return { config: state.config, isDefault: true };
      },
      async set(input: { agentId: string; config: CriticConfig; saveAsDefault: boolean }) {
        state.config = input.config;
        writes.push(input);
      },
    },
  };
}

function fakeContext(updates: Array<{ agentId: string; labels?: Record<string, string> }>) {
  return {
    agent: { id: "agent-1" },
    paseo: {
      agents: {
        ref: (agentId: string) => ({
          update: async (update: { labels?: Record<string, string> }) => {
            updates.push({ agentId, ...update });
          },
        }),
      },
    },
    signal: new AbortController().signal,
  } as unknown as AgentToolContext;
}

describe("set_critic input", () => {
  test("a provider/model string replaces both fields", () => {
    expect(splitCriticModel("claude/claude-opus-4-1", "codex")).toEqual({
      provider: "claude",
      model: "claude-opus-4-1",
    });
  });

  test("a bare model keeps the current provider", () => {
    expect(splitCriticModel("claude-opus-4-1", "claude")).toEqual({
      provider: "claude",
      model: "claude-opus-4-1",
    });
  });

  test("only the fields in the request change", () => {
    const current: CriticConfig = {
      ...DEFAULT_CRITIC_CONFIG,
      enabled: false,
      prompt: "Keep it short.",
      maxRounds: 3,
    };
    expect(
      applySetCriticInput(current, {
        enabled: true,
        mode: "persistent",
        tools: "read",
      }),
    ).toEqual({
      ...current,
      enabled: true,
      mode: "persistent",
      tools: "read",
    });
  });

  test("turning it off leaves the model, prompt and mode alone", () => {
    const current: CriticConfig = {
      ...DEFAULT_CRITIC_CONFIG,
      enabled: true,
      provider: "codex",
      model: "gpt-5.4",
      prompt: "Security only.",
      mode: "persistent",
    };
    expect(applySetCriticInput(current, { enabled: false })).toEqual({
      ...current,
      enabled: false,
    });
  });
});

describe("shouldAttachCriticTool", () => {
  test("attaches to interactive agents", () => {
    expect(shouldAttachCriticTool({ purpose: "interactive", labels: {} })).toBe(true);
  });

  test("never attaches to a history read or to a critic agent", () => {
    expect(shouldAttachCriticTool({ purpose: "history", labels: {} })).toBe(false);
    expect(
      shouldAttachCriticTool({
        purpose: "interactive",
        labels: { [CRITIC_ROLE_LABEL]: CRITIC_ROLE_VALUE },
      }),
    ).toBe(false);
  });
});

describe("plugin wiring", () => {
  function sessionOpenHandler() {
    let handler:
      | ((input: {
          request: { purpose: string; labels: Record<string, string>; tools: unknown[] };
        }) =>
          | {
              tools: Array<{ name: string }>;
            }
          | undefined)
      | null = null;
    const server = {
      handle: () => undefined,
      on: () => () => undefined,
      before: (_name: string, next: typeof handler) => {
        handler = next;
        return () => undefined;
      },
    };
    contribute(server as unknown as PluginServerContext);
    return handler!;
  }

  test("attaches set_critic to an interactive agent", () => {
    const attach = sessionOpenHandler();
    const request = attach({
      request: { purpose: "interactive", labels: {}, tools: [] },
    });
    expect(request?.tools.map((tool) => tool.name)).toEqual(["set_critic"]);
  });

  test("leaves a critic agent's tools alone", () => {
    const attach = sessionOpenHandler();
    const request = attach({
      request: {
        purpose: "interactive",
        labels: { [CRITIC_ROLE_LABEL]: CRITIC_ROLE_VALUE },
        tools: [],
      },
    });
    expect(request).toBeUndefined();
  });
});

describe("set_critic tool", () => {
  test("turns the critic on and keeps the UI label in step", async () => {
    const { state, writes, store } = fakeStore();
    const updates: Array<{ agentId: string; labels?: Record<string, string> }> = [];
    const tool = createSetCriticTool(store);

    const result = await tool.execute(
      {
        enabled: true,
        model: "claude/claude-opus-4-1",
        prompt: "Focus on security.",
        mode: "persistent",
      },
      fakeContext(updates),
    );

    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      agentId: "agent-1",
      saveAsDefault: false,
      config: {
        enabled: true,
        provider: "claude",
        model: "claude-opus-4-1",
        prompt: "Focus on security.",
        mode: "persistent",
      },
    });
    expect(state.config.enabled).toBe(true);
    expect(updates).toEqual([{ agentId: "agent-1", labels: criticEnabledLabel(true) }]);
    expect(updates[0]?.labels?.[CRITIC_ENABLED_LABEL]).toBe("true");
    expect(result.text).toContain("claude/claude-opus-4-1");
    expect(result.text).toContain("persistent");
  });

  test("turns the critic off", async () => {
    const { state, store } = fakeStore({ ...DEFAULT_CRITIC_CONFIG, enabled: true });
    const updates: Array<{ agentId: string; labels?: Record<string, string> }> = [];
    const tool = createSetCriticTool(store);

    const result = await tool.execute({ enabled: false }, fakeContext(updates));

    expect(state.config.enabled).toBe(false);
    expect(updates).toEqual([{ agentId: "agent-1", labels: criticEnabledLabel(false) }]);
    expect(updates[0]?.labels?.[CRITIC_ENABLED_LABEL]).toBe("false");
    expect(result.text).toContain("off");
  });
});
