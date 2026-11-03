import { beforeEach, describe, expect, it } from "vitest";
import {
  buildCriticNotice,
  CRITIC_ENABLED_LABEL,
  CRITIC_PLUGIN_ID,
  CRITIC_RPC,
  DEFAULT_CRITIC_CONFIG,
} from "@getpaseo/protocol/critic";
import { cacheWarmupAgentKey } from "@/cache-warmup/model";
import { useCacheWarmupStore } from "@/cache-warmup/store";
import { useCriticStore } from "@/critic/store";
import { applyDraftComposerExtras, draftComposerCreateExtras } from "./composer-extras";

const serverId = "server-1";
const draftKey = "draft-1";
const agentId = "agent-1";
const criticOn = { ...DEFAULT_CRITIC_CONFIG, enabled: true, provider: "claude", model: "sonnet" };

function fakeClient() {
  const calls: { pluginId: string; method: string; input: unknown }[] = [];
  return {
    calls,
    async invokePluginRpc(pluginId: string, method: string, input: unknown) {
      calls.push({ pluginId, method, input });
      return { ok: true };
    },
  };
}

beforeEach(() => {
  useCriticStore.setState({ drafts: {}, pendingNotice: {}, models: {} });
  useCacheWarmupStore.setState({ disabledAgentKeys: [] });
});

describe("draftComposerCreateExtras", () => {
  it("leaves the first message and labels alone without a critic set up", () => {
    expect(draftComposerCreateExtras({ draftKey, prompt: "hi", labels: { a: "1" } })).toEqual({
      prompt: "hi",
      createOptions: { labels: { a: "1" } },
    });
    expect(draftComposerCreateExtras({ draftKey, prompt: "hi" })).toEqual({
      prompt: "hi",
      createOptions: {},
    });
  });

  it("labels the session and tells the agent when the draft turned the critic on", () => {
    useCriticStore.getState().setDraft(draftKey, { config: criticOn, saveAsDefault: false });
    expect(draftComposerCreateExtras({ draftKey, prompt: "hi", labels: { a: "1" } })).toEqual({
      prompt: `${buildCriticNotice(true)}hi`,
      createOptions: { labels: { a: "1", [CRITIC_ENABLED_LABEL]: "true" } },
    });
  });

  it("sends no notice as an empty first message, which would start a turn", () => {
    useCriticStore.getState().setDraft(draftKey, { config: criticOn, saveAsDefault: false });
    expect(draftComposerCreateExtras({ draftKey, prompt: "" }).prompt).toBe("");
  });
});

describe("applyDraftComposerExtras", () => {
  it("hands the draft's critic config to the new agent and forgets the draft", async () => {
    useCriticStore.getState().setDraft(draftKey, { config: criticOn, saveAsDefault: true });
    const client = fakeClient();
    await applyDraftComposerExtras({ client, serverId, draftKey, agentId, prompt: "hi" });
    expect(client.calls).toEqual([
      {
        pluginId: CRITIC_PLUGIN_ID,
        method: CRITIC_RPC.setConfig,
        input: { agentId, config: criticOn, saveAsDefault: true },
      },
    ]);
    const store = useCriticStore.getState();
    expect(store.drafts).toEqual({});
    expect(store.models[agentId]).toBe("claude/sonnet");
    expect(store.peekNotice(agentId)).toBeUndefined();
  });

  it("queues the notice for the next message when the session started empty", async () => {
    useCriticStore.getState().setDraft(draftKey, { config: criticOn, saveAsDefault: false });
    await applyDraftComposerExtras({
      client: fakeClient(),
      serverId,
      draftKey,
      agentId,
      prompt: "",
    });
    expect(useCriticStore.getState().peekNotice(agentId)).toBe(true);
  });

  it("calls nothing without a critic set up", async () => {
    const client = fakeClient();
    await applyDraftComposerExtras({ client, serverId, draftKey, agentId, prompt: "hi" });
    expect(client.calls).toEqual([]);
  });

  it("keeps the session when the critic plugin fails", async () => {
    useCriticStore.getState().setDraft(draftKey, { config: criticOn, saveAsDefault: false });
    const client = {
      async invokePluginRpc(): Promise<unknown> {
        throw new Error("plugin is off");
      },
    };
    await expect(
      applyDraftComposerExtras({ client, serverId, draftKey, agentId, prompt: "hi" }),
    ).resolves.toBeUndefined();
  });

  it("moves a flame turned off in the draft to the new agent", async () => {
    useCacheWarmupStore.getState().setEnabled(cacheWarmupAgentKey(serverId, draftKey), false);
    await applyDraftComposerExtras({
      client: fakeClient(),
      serverId,
      draftKey,
      agentId,
      prompt: "",
    });
    expect(useCacheWarmupStore.getState().disabledAgentKeys).toEqual([
      cacheWarmupAgentKey(serverId, agentId),
    ]);
  });

  it("leaves the flame on, the default, when the draft did not turn it off", async () => {
    await applyDraftComposerExtras({
      client: fakeClient(),
      serverId,
      draftKey,
      agentId,
      prompt: "",
    });
    expect(useCacheWarmupStore.getState().disabledAgentKeys).toEqual([]);
  });
});
