// CUSTOM(btw): exercises custom/plugins/btw against a real daemon.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";

const pluginDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../custom/plugins/btw",
);
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function waitForBtwRow(
  client: DaemonClient,
  agentId: string,
  id: string,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 15_000;
  let last: Record<string, unknown> | undefined;
  while (Date.now() < deadline) {
    const timeline = await client.fetchAgentTimeline(agentId, { projection: "projected" });
    const row = timeline.entries
      .map((entry) => entry.item)
      .find((item) => item.type === "plugin" && item.kind === "btw" && item.id === id);
    if (row?.type === "plugin") {
      last = row.data as Record<string, unknown>;
      if (last.status !== "asking") return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`btw row never answered; last: ${JSON.stringify(last)}`);
}

test("answers a side question in a plugin row and leaves the agent's history alone", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "paseo-btw-"));
  roots.push(workspace);
  const daemon = await createTestPaseoDaemon();
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.4.0" });
  try {
    await client.connect();
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await expect(client.installDirectoryPlugin(pluginDirectory)).resolves.toMatchObject({
      id: "btw",
      status: "running",
    });
    const agent = await client.createAgent({ provider: "claude", cwd: workspace });

    const direct = await client.askAgentSideQuestion(agent.id, "what changed?");
    expect(direct).toMatchObject({ answer: "side answer: what changed?", error: null });

    const asked = await client.invokePluginRpc("btw", "ask", {
      agentId: agent.id,
      question: "which files?",
    });
    const row = await waitForBtwRow(client, agent.id, (asked as { id: string }).id);
    expect(row).toMatchObject({
      question: "which files?",
      status: "answered",
      answer: "side answer: which files?",
      error: null,
    });

    const timeline = await client.fetchAgentTimeline(agent.id, { projection: "projected" });
    expect(timeline.entries.filter((entry) => entry.item.type === "user_message")).toEqual([]);

    const missing = await client.askAgentSideQuestion("no-such-agent", "hello?");
    expect(missing.answer).toBeNull();
    expect(missing.error).toEqual(expect.any(String));
  } finally {
    await client.close();
    await daemon.close();
  }
}, 60_000);
