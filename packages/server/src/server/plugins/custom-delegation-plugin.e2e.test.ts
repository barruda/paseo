import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { settingsRpc } from "@getpaseo/plugin";
import {
  DELEGATION_PLUGIN_ID,
  DELEGATION_SETTINGS_ID,
  DELEGATION_TIMELINE_KIND,
  type DelegationSettings,
} from "@getpaseo/protocol/delegation";
import { afterEach, expect, test } from "vitest";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";

// CUSTOM(delegation): with delegation on, a new Opus Claude session gets the rule in its saved
// system prompt, a card in its timeline and a line in the session log; a Sonnet session gets none.

const pluginDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../custom/plugins/delegation",
);
const settings = settingsRpc(DELEGATION_SETTINGS_ID);
const MARKER = "# Delegating implementation (Paseo delegation)";
const roots: string[] = [];

afterEach(async () => {
  delete process.env.PASEO_DELEGATION_LOG;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function start(values: Partial<DelegationSettings>) {
  const root = await mkdtemp(path.join(tmpdir(), "paseo-delegation-"));
  roots.push(root);
  const log = path.join(root, "sessions.jsonl");
  process.env.PASEO_DELEGATION_LOG = log;
  const daemon = await createTestPaseoDaemon();
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.4.0" });
  await client.connect();
  await client.patchDaemonConfig({ pluginsEnabled: true });
  await expect(client.installDirectoryPlugin(pluginDirectory)).resolves.toMatchObject({
    id: DELEGATION_PLUGIN_ID,
  });
  const current = (await client.invokePluginRpc(DELEGATION_PLUGIN_ID, settings.read.name, {})) as {
    revision: string;
    values: DelegationSettings;
  };
  await expect(
    client.invokePluginRpc(DELEGATION_PLUGIN_ID, settings.write.name, {
      revision: current.revision,
      values: { ...current.values, ...values },
    }),
  ).resolves.toMatchObject({ status: "saved" });
  // The saved agent records, as text: the rule lands in the config's systemPrompt.
  const storedText = async (): Promise<string> => {
    await daemon.daemon.agentManager.flush();
    const dir = path.join(daemon.paseoHome, "agents");
    const files = await readdir(dir, { recursive: true });
    const texts = await Promise.all(
      files
        .filter((file) => file.endsWith(".json"))
        .map((file) => readFile(path.join(dir, file), "utf8")),
    );
    return texts.join("\n");
  };
  const close = async () => {
    await client.close();
    await daemon.close();
  };
  return { client, root, log, storedText, close };
}

async function timelineKinds(client: DaemonClient, agentId: string): Promise<unknown[]> {
  const timeline = await client.fetchAgentTimeline(agentId, { projection: "projected" });
  return timeline.entries.flatMap((entry) =>
    entry.item.type === "plugin" && entry.item.kind === DELEGATION_TIMELINE_KIND
      ? [entry.item.data]
      : [],
  );
}

async function waitForCard(client: DaemonClient, agentId: string): Promise<unknown> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const [card] = await timelineKinds(client, agentId);
    if (card) return card;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("the delegation card never showed");
}

async function waitForLogLine(file: string): Promise<string> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const text = await readFile(file, "utf8").catch(() => "");
    const [line] = text.trim().split("\n");
    if (line) return line;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("the session log line never showed");
}

test("an Opus session gets the rule, the card and a log line", async () => {
  const env = await start({ enabled: true, implementerEffort: "low", searchModel: "haiku" });
  try {
    const agent = await env.client.createAgent({
      provider: "claude",
      model: "claude-opus-5-5",
      cwd: env.root,
    });
    await expect(waitForCard(env.client, agent.id)).resolves.toEqual({
      implementerModel: "sonnet",
      implementerEffort: "low",
      when: "balanced",
      review: true,
      searchModel: "haiku",
    });
    const stored = await env.storedText();
    expect(stored).toContain(MARKER);
    expect(stored).toContain('model \\"sonnet\\" and effort \\"low\\"');
    // The plugin logs right after appending the card.
    const line = await waitForLogLine(env.log);
    expect(JSON.parse(line)).toMatchObject({
      agentId: agent.id,
      cwd: env.root,
      mainModel: "claude-opus-5-5",
      implementerModel: "sonnet",
    });
  } finally {
    await env.close();
  }
}, 60_000);

test("a Sonnet session and any session while off are left alone", async () => {
  const env = await start({ enabled: true });
  try {
    const sonnet = await env.client.createAgent({
      provider: "claude",
      model: "claude-sonnet-5-5",
      cwd: env.root,
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    await expect(timelineKinds(env.client, sonnet.id)).resolves.toEqual([]);
    expect(await env.storedText()).not.toContain(MARKER);
  } finally {
    await env.close();
  }
  const off = await start({ enabled: false });
  try {
    await off.client.createAgent({ provider: "claude", model: "claude-opus-5-5", cwd: off.root });
    expect(await off.storedText()).not.toContain(MARKER);
  } finally {
    await off.close();
  }
}, 60_000);
