/** Shift+Tab in a message input cycles through the workspaces that had activity this recently. */
export const ACTIVE_WORKSPACE_WINDOW_MS = 45 * 60 * 1000;

export interface CycleWorkspaceTarget {
  serverId: string;
  workspaceId: string;
}

export interface CycleSession {
  workspaces: ReadonlyMap<string, { status: string }>;
  agents: ReadonlyMap<
    string,
    { id: string; workspaceId?: string; archivedAt?: Date | null; lastActivityAt: Date }
  >;
  workspaceAgentActivity: ReadonlyMap<string, { status: string }>;
}

/**
 * The workspaces, in sidebar order, where an agent did something in the last
 * `ACTIVE_WORKSPACE_WINDOW_MS` or is running right now (a long tool call can go quiet for longer).
 * Activity is the newest `lastActivityAt` of the workspace's agents, subagents included.
 */
export function collectRecentlyActiveWorkspaces<T extends CycleWorkspaceTarget>(input: {
  order: readonly T[];
  sessions: Readonly<Record<string, CycleSession | undefined>>;
  agentLastActivity: ReadonlyMap<string, Date>;
  now: number;
  windowMs?: number;
}): T[] {
  const cutoff = input.now - (input.windowMs ?? ACTIVE_WORKSPACE_WINDOW_MS);
  const latestByServer = new Map<string, Map<string, number>>();
  const latestFor = (serverId: string, session: CycleSession) => {
    const cached = latestByServer.get(serverId);
    if (cached) return cached;
    const latest = new Map<string, number>();
    for (const agent of session.agents.values()) {
      if (agent.archivedAt || !agent.workspaceId) continue;
      const at = (input.agentLastActivity.get(agent.id) ?? agent.lastActivityAt).getTime();
      if (at > (latest.get(agent.workspaceId) ?? -Infinity)) latest.set(agent.workspaceId, at);
    }
    latestByServer.set(serverId, latest);
    return latest;
  };

  const seen = new Set<string>();
  return input.order.filter((target) => {
    const key = `${target.serverId}:${target.workspaceId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    const session = input.sessions[target.serverId];
    if (!session) return false;
    if (
      session.workspaces.get(target.workspaceId)?.status === "running" ||
      session.workspaceAgentActivity.get(target.workspaceId)?.status === "running"
    ) {
      return true;
    }
    return (latestFor(target.serverId, session).get(target.workspaceId) ?? -Infinity) >= cutoff;
  });
}

/** The next one after the current workspace, wrapping; the first when the current isn't listed. */
export function nextRecentlyActiveWorkspace(
  targets: readonly CycleWorkspaceTarget[],
  current: CycleWorkspaceTarget | null,
): CycleWorkspaceTarget | null {
  const index = current
    ? targets.findIndex(
        (target) =>
          target.serverId === current.serverId && target.workspaceId === current.workspaceId,
      )
    : -1;
  if (index === -1) return targets[0] ?? null;
  if (targets.length < 2) return null;
  return targets[(index + 1) % targets.length] ?? null;
}
