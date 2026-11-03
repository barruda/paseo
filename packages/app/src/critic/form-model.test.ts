import { describe, expect, it } from "vitest";
import {
  CRITIC_ENABLED_LABEL,
  CRITIC_PLUGIN_ID,
  CRITIC_RPC,
  DEFAULT_CRITIC_CONFIG,
} from "@getpaseo/protocol/critic";
import { base64Bytes, CRITIC_IMAGES_MAX_BYTES, openCriticForm } from "./form-model";
import { loadCriticConfig, saveCriticConfig, type CriticClient } from "./rpc";
import { useCriticStore } from "./store";

describe("openCriticForm", () => {
  it("cannot save until the config loads", () => {
    const form = openCriticForm();
    expect(form.getState()).toMatchObject({ load: { status: "loading" }, canSave: false });
    form.applyLoaded({ ...DEFAULT_CRITIC_CONFIG, prompt: "be strict" });
    expect(form.getState()).toMatchObject({
      load: { status: "ready" },
      canSave: true,
      draft: { prompt: "be strict" },
    });
  });

  it("edits the draft and keeps the loaded config as saved", () => {
    const form = openCriticForm();
    form.applyLoaded(DEFAULT_CRITIC_CONFIG);
    form.setEnabled(true);
    form.setModel("codex", "gpt-5.5");
    form.setMode("persistent");
    form.setTools("read");
    form.setMaxRounds(5);
    const state = form.getState();
    expect(state.draft).toMatchObject({
      enabled: true,
      provider: "codex",
      model: "gpt-5.5",
      mode: "persistent",
      tools: "read",
      maxRounds: 5,
    });
    expect(state.saved?.enabled).toBe(false);
  });

  it("refuses images past the size cap", () => {
    const form = openCriticForm();
    form.applyLoaded(DEFAULT_CRITIC_CONFIG);
    const big = "A".repeat(Math.ceil((CRITIC_IMAGES_MAX_BYTES * 4) / 3) + 8);
    form.addImages([{ name: "a.png", mimeType: "image/png", data: "AAAA" }]);
    form.addImages([{ name: "big.png", mimeType: "image/png", data: big }]);
    expect(form.getState().draft.images.map((image) => image.name)).toEqual(["a.png"]);
    expect(form.getState().error).toMatch(/8 MB/);
    form.removeImage(0);
    expect(form.getState().draft.images).toEqual([]);
  });

  it("measures base64 payloads", () => {
    expect(base64Bytes("AAAA")).toBe(3);
    expect(base64Bytes("AA==")).toBe(1);
  });
});

function fakeClient(options: { failRpc?: boolean } = {}) {
  const calls: string[] = [];
  const client: CriticClient = {
    async invokePluginRpc(pluginId, method) {
      calls.push(`rpc:${pluginId}:${method}`);
      if (options.failRpc) throw new Error("plugin critic is not running");
      return { config: { ...DEFAULT_CRITIC_CONFIG, enabled: true }, isDefault: false };
    },
    async updateAgent(_agentId, updates) {
      calls.push(`labels:${JSON.stringify(updates.labels)}`);
    },
  };
  return { client, calls };
}

describe("critic rpc", () => {
  it("loads the config", async () => {
    const { client } = fakeClient();
    await expect(loadCriticConfig(client, "a1")).resolves.toMatchObject({ enabled: true });
  });

  it("saves the config, then the label, and reports a toggle", async () => {
    const { client, calls } = fakeClient();
    const result = await saveCriticConfig({
      client,
      agentId: "a1",
      config: { ...DEFAULT_CRITIC_CONFIG, enabled: true },
      saved: DEFAULT_CRITIC_CONFIG,
      saveAsDefault: false,
    });
    expect(result).toEqual({ enabledChanged: true });
    expect(calls).toEqual([
      `rpc:${CRITIC_PLUGIN_ID}:${CRITIC_RPC.setConfig}`,
      `labels:${JSON.stringify({ [CRITIC_ENABLED_LABEL]: "true" })}`,
    ]);
  });

  it("leaves the label alone when the plugin is missing", async () => {
    const { client, calls } = fakeClient({ failRpc: true });
    await expect(
      saveCriticConfig({
        client,
        agentId: "a1",
        config: DEFAULT_CRITIC_CONFIG,
        saved: null,
        saveAsDefault: false,
      }),
    ).rejects.toThrow(/not running/);
    expect(calls).toEqual([`rpc:${CRITIC_PLUGIN_ID}:${CRITIC_RPC.setConfig}`]);
  });
});

describe("useCriticStore", () => {
  it("queues a notice and cancels it when toggled back", () => {
    const store = useCriticStore.getState();
    store.toggleNotice("a1", true);
    expect(useCriticStore.getState().peekNotice("a1")).toBe(true);
    useCriticStore.getState().toggleNotice("a1", false);
    expect(useCriticStore.getState().peekNotice("a1")).toBeUndefined();
    useCriticStore.getState().toggleNotice("a1", false);
    expect(useCriticStore.getState().peekNotice("a1")).toBe(false);
    useCriticStore.getState().consumeNotice("a1");
    expect(useCriticStore.getState().peekNotice("a1")).toBeUndefined();
  });
});
