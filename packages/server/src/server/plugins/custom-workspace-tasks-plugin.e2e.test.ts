// CUSTOM(workspace-tasks): exercises custom/plugins/workspace-tasks against a real daemon.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";

const pluginDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../custom/plugins/workspace-tasks",
);
const roots: string[] = [];
const originalPaseoHome = process.env.PASEO_HOME;

afterEach(async () => {
  if (originalPaseoHome === undefined) delete process.env.PASEO_HOME;
  else process.env.PASEO_HOME = originalPaseoHome;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface TaskState {
  tasks: Array<{ text: string; status: string; agentId: string | null }>;
  autoAgentId: string | null;
}

async function userMessages(client: DaemonClient, agentId: string): Promise<string[]> {
  const timeline = await client.fetchAgentTimeline(agentId, { projection: "projected" });
  return timeline.entries
    .map((entry) => entry.item)
    .flatMap((item) => (item.type === "user_message" ? [item.text] : []));
}

async function waitForTasks(
  client: DaemonClient,
  workspaceId: string,
  predicate: (state: TaskState) => boolean,
): Promise<TaskState> {
  const deadline = Date.now() + 15_000;
  let last: TaskState | undefined;
  while (Date.now() < deadline) {
    last = (await client.invokePluginRpc("workspace-tasks", "list", { workspaceId })) as TaskState;
    if (predicate(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`task list never matched; last: ${JSON.stringify(last)}`);
}

test("sends tasks to an agent one at a time, by command and automatically", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "paseo-workspace-tasks-"));
  roots.push(workspace);
  const daemon = await createTestPaseoDaemon();
  // The plugin subprocess inherits this; without it the test would write to the real ~/.paseo.
  process.env.PASEO_HOME = daemon.paseoHome;
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.4.0" });
  try {
    await client.connect();
    await client.fetchAgents({ subscribe: {} });
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await expect(client.installDirectoryPlugin(pluginDirectory)).resolves.toMatchObject({
      id: "workspace-tasks",
      status: "running",
    });
    const agent = await client.createAgent({ provider: "claude", cwd: workspace });
    const workspaceId = agent.workspaceId;
    expect(workspaceId).toBeTruthy();
    if (!workspaceId) return;

    for (const text of ["first task", "second task", "third task"]) {
      await client.invokePluginRpc("workspace-tasks", "add", { workspaceId, text });
    }

    await expect(
      client.invokePluginRpc("workspace-tasks", "next", { workspaceId, agentId: agent.id }),
    ).resolves.toMatchObject({ result: "sent", task: { text: "first task" } });
    await client.waitForFinish(agent.id, 30_000);
    expect((await userMessages(client, agent.id)).at(-1)).toContain("first task");

    // Auto-next: each completed turn finishes the active task and sends the next one, then turns
    // itself off when the list runs out.
    await client.invokePluginRpc("workspace-tasks", "set-auto", {
      workspaceId,
      agentId: agent.id,
      enabled: true,
    });
    await client.invokePluginRpc("workspace-tasks", "next", { workspaceId, agentId: agent.id });
    const finished = await waitForTasks(
      client,
      workspaceId,
      (state) => state.autoAgentId === null && state.tasks.every((task) => task.status === "done"),
    );
    expect(finished.tasks.map((task) => task.text)).toEqual([
      "first task",
      "second task",
      "third task",
    ]);
    const messages = await userMessages(client, agent.id);
    expect(
      messages.filter((text) => text.includes("Next task from the workspace task list")),
    ).toHaveLength(3);
  } finally {
    await client.close().catch(() => undefined);
    await daemon.close();
  }
}, 60_000);
