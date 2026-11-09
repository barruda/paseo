import { describe, expect, it } from "vitest";
import {
  CRITIC_ENABLED_LABEL,
  CRITIC_MAX_ROUNDS_LIMIT,
  CRITIC_PLUGIN_ID,
  CRITIC_RPC,
  CriticConfigSchema,
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
    form.setMaxRoundsText("5");
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

  it("starts max rounds at 10 and shows the loaded value in the field", () => {
    expect(DEFAULT_CRITIC_CONFIG.maxRounds).toBe(10);
    const form = openCriticForm();
    form.applyLoaded({ ...DEFAULT_CRITIC_CONFIG, maxRounds: 7 });
    expect(form.getState()).toMatchObject({ maxRoundsText: "7", maxRoundsError: null });
  });

  it("accepts max rounds up to the limit and saves a config the schema accepts", () => {
    const form = openCriticForm();
    form.applyLoaded(DEFAULT_CRITIC_CONFIG);
    form.setMaxRoundsText(String(CRITIC_MAX_ROUNDS_LIMIT));
    const state = form.getState();
    expect(state).toMatchObject({ canSave: true, maxRoundsError: null });
    expect(state.draft.maxRounds).toBe(50);
    expect(CriticConfigSchema.safeParse(state.draft).success).toBe(true);
  });

  it.each(["", "0", "51", "2.5", "-1", "abc"])("blocks saving with max rounds %j", (text) => {
    const form = openCriticForm();
    form.applyLoaded({ ...DEFAULT_CRITIC_CONFIG, maxRounds: 7 });
    form.setMaxRoundsText(text);
    const state = form.getState();
    expect(state).toMatchObject({ canSave: false, maxRoundsText: text });
    expect(state.maxRoundsError).toMatch(/1 to 50/);
    expect(state.draft.maxRounds).toBe(7);
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
