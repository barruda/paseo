// CUSTOM(shell-command): exercises custom/plugins/shell-command against a real daemon.
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import { DaemonClient } from "../test-utils/daemon-client.js";
import { createTestPaseoDaemon } from "../test-utils/paseo-daemon.js";

const pluginDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../../custom/plugins/shell-command",
);
const roots: string[] = [];
const originalPaseoHome = process.env.PASEO_HOME;

afterEach(async () => {
  if (originalPaseoHome === undefined) delete process.env.PASEO_HOME;
  else process.env.PASEO_HOME = originalPaseoHome;
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

// The plugin process inherits the daemon's environment; point its history file at the test home.
async function startDaemon() {
  const daemon = await createTestPaseoDaemon();
  process.env.PASEO_HOME = daemon.paseoHome;
  return daemon;
}

async function waitForShellRow(
  client: DaemonClient,
  agentId: string,
  id: string,
  predicate: (data: Record<string, unknown>) => boolean,
): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 15_000;
  let last: Record<string, unknown> | undefined;
  while (Date.now() < deadline) {
    const timeline = await client.fetchAgentTimeline(agentId, { projection: "projected" });
    const row = timeline.entries
      .map((entry) => entry.item)
      .find((item) => item.type === "plugin" && item.kind === "shell-command" && item.id === id);
    if (row?.type === "plugin") {
      last = row.data as Record<string, unknown>;
      if (predicate(last)) return last;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`shell-command row never matched; last: ${JSON.stringify(last)}`);
}

test("runs a command in the agent cwd and records the output as a plugin row", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "paseo-shell-command-"));
  roots.push(workspace);
  const daemon = await startDaemon();
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.4.0" });
  try {
    await client.connect();
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await expect(client.installDirectoryPlugin(pluginDirectory)).resolves.toMatchObject({
      id: "shell-command",
      status: "running",
    });
    const agent = await client.createAgent({ provider: "claude", cwd: workspace });

    const failing = await client.invokePluginRpc("shell-command", "run", {
      agentId: agent.id,
      cwd: workspace,
      command: "pwd; printf '\\033[31mred\\033[0m\\n'; echo oops >&2; exit 3",
    });
    const done = await waitForShellRow(
      client,
      agent.id,
      (failing as { id: string }).id,
      (data) => data.status !== "running",
    );
    expect(done).toMatchObject({ status: "failed", exitCode: 3, truncated: false });
    expect(String(done.output).split("\n")).toEqual(
      expect.arrayContaining([expect.stringContaining(path.basename(workspace)), "red", "oops"]),
    );

    const started = await client.invokePluginRpc("shell-command", "run", {
      agentId: agent.id,
      cwd: workspace,
      command: "echo started; sleep 30",
    });
    const id = (started as { id: string }).id;
    await waitForShellRow(client, agent.id, id, (data) => data.output === "started\n");
    await expect(client.invokePluginRpc("shell-command", "stop", { id })).resolves.toEqual({
      stopped: true,
    });
    await expect(
      waitForShellRow(client, agent.id, id, (data) => data.status === "stopped"),
    ).resolves.toMatchObject({ status: "stopped" });
  } finally {
    await client.close().catch(() => undefined);
    await daemon.close();
  }
}, 60_000);

test("passes typed input and Ctrl-C to a running command", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "paseo-shell-command-"));
  roots.push(workspace);
  const daemon = await startDaemon();
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.4.0" });
  try {
    await client.connect();
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await client.installDirectoryPlugin(pluginDirectory);
    const agent = await client.createAgent({ provider: "claude", cwd: workspace });

    const prompt = (await client.invokePluginRpc("shell-command", "run", {
      agentId: agent.id,
      cwd: workspace,
      command: 'read -r name; echo "got $name"',
    })) as { id: string };
    await waitForShellRow(client, agent.id, prompt.id, (data) => data.status === "running");
    await expect(
      client.invokePluginRpc("shell-command", "input", { id: prompt.id, text: "paseo\n" }),
    ).resolves.toEqual({ accepted: true });
    const answered = await waitForShellRow(
      client,
      agent.id,
      prompt.id,
      (data) => data.status !== "running",
    );
    expect(answered).toMatchObject({ status: "completed", exitCode: 0 });
    expect(String(answered.output)).toContain("got paseo");
    await expect(
      client.invokePluginRpc("shell-command", "input", { id: prompt.id, text: "late\n" }),
    ).resolves.toEqual({ accepted: false });

    const sleeping = (await client.invokePluginRpc("shell-command", "run", {
      agentId: agent.id,
      cwd: workspace,
      command: "sleep 30",
    })) as { id: string };
    await waitForShellRow(client, agent.id, sleeping.id, (data) => data.status === "running");
    await client.invokePluginRpc("shell-command", "input", { id: sleeping.id, text: "\x03" });
    await expect(
      waitForShellRow(client, agent.id, sleeping.id, (data) => data.status !== "running"),
    ).resolves.toMatchObject({ status: "failed" });
  } finally {
    await client.close().catch(() => undefined);
    await daemon.close();
  }
}, 60_000);

test("keeps history per project and completes paths", async () => {
  const workspace = await mkdtemp(path.join(tmpdir(), "paseo-shell-command-"));
  roots.push(workspace);
  await mkdir(path.join(workspace, "src"));
  await writeFile(path.join(workspace, "src", "config.ts"), "");
  const daemon = await startDaemon();
  const client = new DaemonClient({ url: `ws://127.0.0.1:${daemon.port}/ws`, appVersion: "0.4.0" });
  try {
    await client.connect();
    await client.patchDaemonConfig({ pluginsEnabled: true });
    await client.installDirectoryPlugin(pluginDirectory);
    const agent = await client.createAgent({ provider: "claude", cwd: workspace });
    const workspaceId = agent.workspaceId!;
    expect(workspaceId).toBeTruthy();

    for (const command of ["echo one", "echo two", "echo one"]) {
      await client.invokePluginRpc("shell-command", "run", {
        agentId: agent.id,
        cwd: workspace,
        command,
        workspaceId,
      });
    }
    const deadline = Date.now() + 10_000;
    let history: unknown;
    while (Date.now() < deadline) {
      history = await client.invokePluginRpc("shell-command", "history", {
        cwd: workspace,
        workspaceId,
      });
      if ((history as { commands: string[] }).commands.length === 2) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(history).toEqual({ commands: ["echo one", "echo two"] });
    const saved = JSON.parse(
      await readFile(
        path.join(daemon.paseoHome, "plugin-data", "shell-command", "history.json"),
        "utf8",
      ),
    ) as { projects: Record<string, string[]> };
    expect(Object.keys(saved.projects)).toEqual([expect.stringMatching(/^project:/)]);
    // A directory without a workspace keeps its own history.
    await expect(
      client.invokePluginRpc("shell-command", "history", { cwd: path.join(workspace, "src") }),
    ).resolves.toEqual({ commands: [] });

    await expect(
      client.invokePluginRpc("shell-command", "complete-path", { cwd: workspace, word: "src/c" }),
    ).resolves.toEqual({ entries: [{ value: "src/config.ts", kind: "file" }] });
  } finally {
    await client.close().catch(() => undefined);
    await daemon.close();
  }
}, 60_000);
