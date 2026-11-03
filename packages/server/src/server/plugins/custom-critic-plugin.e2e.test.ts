// CUSTOM(critic): exercises custom/plugins/critic against a real daemon with fake providers.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CRITIC_ENABLED_LABEL,
  CRITIC_ROLE_LABEL,
  CRITIC_ROLE_VALUE,
  type CriticConfig,
  DEFAULT_CRITIC_CONFIG,
} from "@getpaseo/protocol/critic";
import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import { afterEach, expect, test } from "vitest";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";

const pluginDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../custom/plugins/critic",
);
const roots: string[] = [];
const originalPaseoHome = process.env.PASEO_HOME;

afterEach(async () => {
  if (originalPaseoHome === undefined) delete process.env.PASEO_HOME;
  else process.env.PASEO_HOME = originalPaseoHome;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface ReviewRow {
  round: number;
  status: string;
  feedback: string | null;
  criticAgentId: string | null;
}

async function reviewRows(client: DaemonClient, agentId: string): Promise<ReviewRow[]> {
  const timeline = await client.fetchAgentTimeline(agentId, { projection: "projected" });
  return timeline.entries.flatMap((entry) =>
    entry.item.type === "plugin" && entry.item.kind === "critic-review"
      ? [entry.item.data as unknown as ReviewRow]
      : [],
  );
}

async function waitForReview(
  client: DaemonClient,
  agentId: string,
  done: (rows: ReviewRow[]) => boolean,
): Promise<ReviewRow[]> {
  const deadline = Date.now() + 20_000;
  let rows: ReviewRow[] = [];
  while (Date.now() < deadline) {
    rows = await reviewRows(client, agentId);
    if (done(rows)) return rows;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`critic never settled; rows: ${JSON.stringify(rows)}`);
}

async function startReviewedAgent(verdict: string, overrides: Partial<CriticConfig> = {}) {
  const workspace = await mkdtemp(path.join(tmpdir(), "paseo-critic-"));
  roots.push(workspace);
  const daemon = await createTestPaseoDaemon();
  // The plugin process inherits the daemon's environment; its config file goes to the test home.
  process.env.PASEO_HOME = daemon.paseoHome;
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.4.0" });
  await client.connect();
  await client.patchDaemonConfig({ pluginsEnabled: true });
  await expect(client.installDirectoryPlugin(pluginDirectory)).resolves.toMatchObject({
    id: "critic",
    status: "running",
  });
  const agent = await client.createAgent({
    provider: "claude",
    cwd: workspace,
    labels: { [CRITIC_ENABLED_LABEL]: "true" },
  });
  const config: CriticConfig = {
    ...DEFAULT_CRITIC_CONFIG,
    enabled: true,
    includeDiff: false,
    // The fake provider replies with the first "respond with exactly" line of its prompt, and
    // the reviewer instructions come first in the critic's prompt.
    prompt: `Respond with exactly: <verdict>${verdict}</verdict>`,
    ...overrides,
  };
  await client.invokePluginRpc("critic", "config.set", {
    agentId: agent.id,
    config,
    saveAsDefault: false,
  });
  return { daemon, client, agent };
}

test("a rejected answer goes back to the agent until the last round", async () => {
  const { daemon, client, agent } = await startReviewedAgent(
    '{"verdict":"rejected","feedback":"Add tests."}',
    { maxRounds: 2 },
  );
  try {
    await client.sendAgentMessage(agent.id, "Respond with exactly: done");
    const rows = await waitForReview(client, agent.id, (all) =>
      all.some((row) => row.status === "limit"),
    );
    expect(rows.map(({ round, status }) => ({ round, status }))).toEqual([
      { round: 1, status: "rejected" },
      { round: 2, status: "limit" },
    ]);
    expect(rows[1]?.feedback).toBe("Add tests.");

    const timeline = await client.fetchAgentTimeline(agent.id, { projection: "projected" });
    const userTexts = timeline.entries.flatMap((entry) =>
      entry.item.type === "user_message" ? [entry.item.text] : [],
    );
    expect(userTexts).toEqual([
      "Respond with exactly: done",
      expect.stringMatching(
        /^<critic-feedback round="1">[\s\S]*Add tests\.[\s\S]*<\/critic-feedback>$/,
      ),
    ]);

    // Both rounds used the same critic, a subagent of the reviewed agent that never notifies.
    expect(rows[0]?.criticAgentId).toBeTruthy();
    expect(rows[1]?.criticAgentId).toBe(rows[0]?.criticAgentId);
    const critic = await client.fetchAgent(rows[0]!.criticAgentId!);
    expect(critic?.agent.labels[CRITIC_ROLE_LABEL]).toBe(CRITIC_ROLE_VALUE);
    expect(critic?.agent.labels[PARENT_AGENT_ID_LABEL]).toBe(agent.id);
    expect(critic?.agent.requiresAttention ?? false).toBe(false);

    const reviewed = await client.fetchAgent(agent.id);
    expect(reviewed?.agent).toMatchObject({ requiresAttention: true, attentionReason: "finished" });
  } finally {
    await client.close();
    await daemon.close();
  }
}, 60_000);

test("an approved answer is finished once, when the critic approves", async () => {
  const { daemon, client, agent } = await startReviewedAgent('{"verdict":"approved"}');
  try {
    await client.sendAgentMessage(agent.id, "Respond with exactly: done");
    const rows = await waitForReview(client, agent.id, (all) =>
      all.some((row) => row.status === "approved"),
    );
    expect(rows.map((row) => row.status)).toEqual(["approved"]);
    const timeline = await client.fetchAgentTimeline(agent.id, { projection: "projected" });
    expect(timeline.entries.filter((entry) => entry.item.type === "user_message")).toHaveLength(1);
    const reviewed = await client.fetchAgent(agent.id);
    expect(reviewed?.agent).toMatchObject({ requiresAttention: true, attentionReason: "finished" });
  } finally {
    await client.close();
    await daemon.close();
  }
}, 60_000);
