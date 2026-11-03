import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { settingsRpc } from "@getpaseo/plugin";
import {
  JEV_ROUTER_PLUGIN_ID,
  JEV_ROUTER_RPC,
  JEV_ROUTER_SETTINGS_ID,
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

// Stands in for route.py: records its argv, stdin and key, and always picks sonnet/low.
const FAKE_ROUTER = `import json, os, sys
prompt = sys.stdin.read()
json.dump({"argv": sys.argv[1:], "prompt": prompt, "key": os.environ.get("TYPESAFE_API_KEY")},
          open(os.environ["FAKE_ROUTER_RECORD"], "w"))
print(json.dumps({"model": "sonnet", "model_id": "claude-sonnet-5-5", "effort": "low", "why": "small",
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
  const recorded = async () => JSON.parse(await readFile(record, "utf8"));
  const close = async () => {
    await client.close();
    await daemon.close();
  };
  return { route, recorded, close, root };
}

test("applies a cheaper pick and passes prompt, key and session facts to the script", async () => {
  const router = await startRouter({ enabled: true, apply: true, apiKey: "test-key" });
  try {
    await expect(router.route({})).resolves.toMatchObject({
      status: "routed",
      model: "claude-sonnet-5-5",
      thinkingOptionId: "low",
      applied: true,
      labels: { "custom.jev.pick": "sonnet/low", "custom.jev.home": "opus/high" },
    });
    const call = await router.recorded();
    expect(call.prompt).toBe("rename foo to bar");
    expect(call.key).toBe("test-key");
    expect(call.argv).toEqual(
      expect.arrayContaining(["--cwd", router.root, "--images", "1", "--home", "opus/high"]),
    );
  } finally {
    await router.close();
  }
}, 60_000);

test("shadow mode labels the pick without applying it; disabled skips the script", async () => {
  const shadow = await startRouter({ enabled: true, apply: false });
  try {
    await expect(shadow.route({})).resolves.toMatchObject({
      status: "routed",
      applied: false,
      labels: { "custom.jev.applied": "false", "custom.jev.pick": "sonnet/low" },
    });
  } finally {
    await shadow.close();
  }
  const off = await startRouter({ enabled: false });
  try {
    await expect(off.route({})).resolves.toEqual({ status: "skipped", reason: "disabled" });
    await expect(off.route({ provider: "codex", test: true })).resolves.toMatchObject({
      status: "skipped",
    });
  } finally {
    await off.close();
  }
}, 60_000);

test("a script that can't run keeps the selected model", async () => {
  const router = await startRouter({ enabled: true, apply: true, python: "/nonexistent/python" });
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
