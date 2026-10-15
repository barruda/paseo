import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { AgentSessionConfig } from "@getpaseo/protocol/agent-types";
import type { VoiceSessionTarget } from "./session";

const VOICE_DIRECTORY = "~/.paseo-voice";
const LABELS = { "custom.sidebar-voice": "true" };

// The host label survives app restarts. The pending key keeps retries from creating duplicates.
export function createSidebarVoiceHost(newId: () => string) {
  const pendingKeys = new Map<string, string>();
  return async function resolveAgent(
    client: Pick<
      DaemonClient,
      "fetchAgents" | "createWorkspace" | "listDirectory" | "createFileEntry"
    >,
    serverId: string,
    config: AgentSessionConfig,
  ): Promise<VoiceSessionTarget> {
    const existing = await client.fetchAgents({
      filter: { labels: LABELS, includeArchived: false, includeBackground: true },
      sort: [{ key: "created_at", direction: "desc" }],
      page: { limit: 1 },
    });
    const agent = existing.entries[0]?.agent;
    if (agent) return { serverId, agentId: agent.id, workspaceId: agent.workspaceId ?? null };
    // A dedicated directory avoids watching the user's entire home as a workspace.
    const home = await client.listDirectory("~", ".");
    if (!home.entries.some((entry) => entry.name === ".paseo-voice")) {
      const directory = await client.createFileEntry({
        cwd: "~",
        parentPath: ".",
        name: ".paseo-voice",
        kind: "directory",
      });
      if (!directory.success)
        throw new Error(directory.error ?? "Could not create the voice directory.");
    }
    let key = pendingKeys.get(serverId);
    if (!key) {
      key = newId();
      pendingKeys.set(serverId, key);
    }
    const created = await client.createWorkspace({
      idempotencyKey: key,
      source: { kind: "directory", path: VOICE_DIRECTORY },
      title: "Voice",
      background: true,
      agent: {
        config: { ...config, cwd: VOICE_DIRECTORY, title: "Voice" },
        initialPrompt: "",
        labels: LABELS,
      },
    });
    if (created.error || !created.agent || !created.workspace)
      throw new Error(created.error ?? "Could not create the voice session. Try again.");
    pendingKeys.delete(serverId);
    return { serverId, agentId: created.agent.id, workspaceId: created.workspace.id };
  };
}
