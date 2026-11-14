import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { settingsRpc } from "@getpaseo/plugin";
import {
  JEV_ROUTER_PLUGIN_ID,
  JEV_ROUTER_RPC,
  JEV_ROUTER_SETTINGS_ID,
  JEV_TIMELINE_KIND,
  JEV_UPGRADE_TIMELINE_KIND,
  type JevRouterSettings,
} from "@getpaseo/protocol/jev-router";
import { afterEach, expect, test } from "vitest";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";

// CUSTOM(jev-router): the plugin reads its host settings, runs the router script with the prompt on
// stdin and the key in the environment, and turns its answer into a model/effort and labels.

const pluginDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../custom/plugins/jev-router",
);
const settings = settingsRpc(JEV_ROUTER_SETTINGS_ID);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// Stands in for route.py: records its argv, stdin and TypeSafe provider, and always picks sonnet/low.
const FAKE_ROUTER = `import json, os, sys
prompt = sys.stdin.read()
json.dump({"argv": sys.argv[1:], "prompt": prompt, "key": os.environ.get("TYPESAFE_API_KEY"),
           "url": os.environ.get("TYPESAFE_API_URL"), "jev": os.environ.get("JEV_MODEL")},
          open(os.environ["FAKE_ROUTER_RECORD"], "w"))
print(json.dumps({"model": "sonnet", "model_id": "claude-sonnet-5-5", "effort": "low",
                  "why": os.environ.get("FAKE_ROUTER_WHY", "small"), "jev_effort": "medium",
                  "usage": {"input_tokens": 900, "output_tokens": 12},
                  "changed": True, "latency_ms": 5}))
`;

async function startRouter(values: Partial<JevRouterSettings>) {
  const root = await mkdtemp(path.join(tmpdir(), "paseo-jev-router-"));
  roots.push(root);
  const script = path.join(root, "route.py");
  const record = path.join(root, "record.json");
  await writeFile(script, FAKE_ROUTER);
  await chmod(script, 0o755);
  process.env.FAKE_ROUTER_RECORD = record;
  const daemon = await createTestPaseoDaemon();
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.4.0" });
  await client.connect();
  await client.patchDaemonConfig({ pluginsEnabled: true });
  await expect(client.installDirectoryPlugin(pluginDirectory)).resolves.toMatchObject({
    id: JEV_ROUTER_PLUGIN_ID,
  });
  const current = (await client.invokePluginRpc(JEV_ROUTER_PLUGIN_ID, settings.read.name, {})) as {
    revision: string;
    values: JevRouterSettings;
  };
  await expect(
    client.invokePluginRpc(JEV_ROUTER_PLUGIN_ID, settings.write.name, {
      revision: current.revision,
      values: { ...current.values, routerScript: script, ...values },
    }),
  ).resolves.toMatchObject({ status: "saved" });
  const route = (input: Record<string, unknown>) =>
    client.invokePluginRpc(JEV_ROUTER_PLUGIN_ID, JEV_ROUTER_RPC.route, {
      prompt: "rename foo to bar",
      cwd: root,
      images: 1,
      provider: "claude",
      model: "claude-opus-5-5",
      thinkingOptionId: "high",
      ...input,
    });
  const upgrade = (input: Record<string, unknown>) =>
    client.invokePluginRpc(JEV_ROUTER_PLUGIN_ID, JEV_ROUTER_RPC.upgrade, {
      prompt: "why does the build hang?",
      cwd: root,
      images: 0,
      provider: "claude",
      model: "claude-opus-5-5",
      thinkingOptionId: "low",
      availableEfforts: ["low", "medium", "high", "xhigh", "max"],
      ...input,
    });
  const recorded = async () => JSON.parse(await readFile(record, "utf8"));
  const close = async () => {
    await client.close();
    await daemon.close();
  };
  return { route, upgrade, recorded, close, root, client };
}

async function waitForCard(client: DaemonClient, agentId: string): Promise<unknown> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const timeline = await client.fetchAgentTimeline(agentId, { projection: "projected" });
    const card = timeline.entries.find(
      (entry) => entry.item.type === "plugin" && entry.item.kind === JEV_TIMELINE_KIND,
    );
    if (card && card.item.type === "plugin") return card.item.data;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("the jev-route card never showed");
}

test("applies a cheaper pick, passes prompt, provider and session facts, and cards the agent", async () => {
  const router = await startRouter({
    apiKey: "test-key",
    apiUrl: "https://gw.example/v1/systemone",
    jevModel: "jev-test",
    modelFocused: { smallThreshold: 0.7, hardThreshold: 0.3, useSonnet: true },
  });
  try {
    const output = (await router.route({})) as { labels: Record<string, string> };
    expect(output).toMatchObject({
      status: "routed",
      model: "claude-sonnet-5-5",
      thinkingOptionId: "low",
      applied: true,
      labels: { "custom.jev.pick": "sonnet/low", "custom.jev.home": "opus/high" },
    });
    const call = await router.recorded();
    expect(call.prompt).toBe("rename foo to bar");
    expect(call).toMatchObject({
      key: "test-key",
      url: "https://gw.example/v1/systemone",
      jev: "jev-test",
    });
    expect(call.argv).toEqual(
      expect.arrayContaining(["--cwd", router.root, "--images", "1", "--home", "opus/high"]),
    );

    // The app creates the agent with the route's labels; the plugin then appends the card.
    const agent = await router.client.createAgent({
      provider: "claude",
      cwd: router.root,
      labels: output.labels,
    });
    await expect(waitForCard(router.client, agent.id)).resolves.toEqual({
      pickModelId: "claude-sonnet-5-5",
      pickEffort: "low",
      why: "small",
      homeModelId: "claude-opus-5-5",
      homeThinkingOptionId: "high",
      prompt: "rename foo to bar",
    });
  } finally {
    await router.close();
  }
}, 60_000);

test("off skips the script; the settings test reports without applying", async () => {
  const off = await startRouter({
    enabled: false,
    modelFocused: { smallThreshold: 0.7, hardThreshold: 0.3, useSonnet: true },
  });
  try {
    await expect(off.route({})).resolves.toEqual({ status: "skipped", reason: "off" });
    await expect(off.route({ test: true })).resolves.toMatchObject({
      status: "routed",
      applied: false,
      model: null,
      labels: { "custom.jev.pick": "sonnet/low", "custom.jev.applied": "false" },
    });
    await expect(off.route({ provider: "codex", test: true })).resolves.toMatchObject({
      status: "skipped",
    });
  } finally {
    await off.close();
  }
}, 60_000);

test("a script that can't run keeps the selected model", async () => {
  const router = await startRouter({ python: "/nonexistent/python" });
  try {
    await expect(router.route({})).resolves.toMatchObject({
      status: "routed",
      applied: false,
      model: null,
      labels: { "custom.jev.why": "error", "custom.jev.pick": "opus/high" },
    });
  } finally {
    await router.close();
  }
}, 60_000);

test("upgrade raises the effort for a hard follow-up and cards the agent, never when off", async () => {
  process.env.FAKE_ROUTER_WHY = "hard";
  const router = await startRouter({ upgradeEffort: { enabled: true, efforts: ["high", "max"] } });
  try {
    const agent = await router.client.createAgent({ provider: "claude", cwd: router.root });
    const output = await router.upgrade({ agentId: agent.id });
    expect(output).toMatchObject({
      status: "checked",
      upgraded: true,
      from: "low",
      to: "high",
      decision: { why: "hard", usage: { inputTokens: 900, outputTokens: 12 } },
    });
    const call = await router.recorded();
    expect(call.argv).toEqual(
      expect.arrayContaining(["--policy", "effort_focused", "--home", "opus/low", "--no-log"]),
    );
    const deadline = Date.now() + 10_000;
    let card: unknown;
    while (!card && Date.now() < deadline) {
      const timeline = await router.client.fetchAgentTimeline(agent.id, {
        projection: "projected",
      });
      const entry = timeline.entries.find(
        (item) => item.item.type === "plugin" && item.item.kind === JEV_UPGRADE_TIMELINE_KIND,
      );
      if (entry?.item.type === "plugin") card = entry.item.data;
      else await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(card).toEqual({
      modelId: "claude-opus-5-5",
      fromEffort: "low",
      toEffort: "high",
      why: "hard",
      jevEffort: "medium",
    });
    await expect(router.upgrade({ agentId: agent.id, thinkingOptionId: "max" })).resolves.toEqual({
      status: "skipped",
      reason: "nothing to raise",
    });
    await expect(router.upgrade({ agentId: agent.id, provider: "codex" })).resolves.toMatchObject({
      status: "skipped",
    });
  } finally {
    delete process.env.FAKE_ROUTER_WHY;
    await router.close();
  }
}, 60_000);

test("upgrade is skipped while the setting is off", async () => {
  const router = await startRouter({});
  try {
    await expect(router.upgrade({ agentId: "x" })).resolves.toEqual({
      status: "skipped",
      reason: "off",
    });
  } finally {
    await router.close();
  }
}, 60_000);
