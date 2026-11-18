// CUSTOM(auto-archive-skip-pinned): which agents this client pinned in the Tasks sidebar, and which
// label writes tell the daemon so. The daemon skips pinned agents in auto-archive.

/** Pin keys are `${serverId}:${agentId}`; the agentId is a UUID, so split at the last ':'. */
export function selectPinnedAgentIds(keys: readonly string[]): Map<string, Set<string>> {
  const byServer = new Map<string, Set<string>>();
  for (const key of keys) {
    const index = key.lastIndexOf(":");
    if (index < 0) continue;
    const serverId = key.slice(0, index);
    const agentId = key.slice(index + 1);
    const ids = byServer.get(serverId) ?? new Set<string>();
    ids.add(agentId);
    byServer.set(serverId, ids);
  }
  return byServer;
}

export interface PinLabelWrite {
  agentId: string;
  value: "true" | "false";
}

/**
 * Only agents whose label differs. A missing label means unpinned. An archived agent still marked
 * "true" is released so the daemon can archive its worktree; unarchiving writes "true" again.
 */
export function getPinLabelWrites(input: {
  label: string;
  pinnedAgentIds: ReadonlySet<string>;
  agents: ReadonlyMap<
    string,
    { labels: Readonly<Record<string, string>>; archivedAt?: Date | null }
  >;
  pending?: ReadonlySet<string>;
}): PinLabelWrite[] {
  const writes: PinLabelWrite[] = [];
  for (const [agentId, agent] of input.agents) {
    const value = input.pinnedAgentIds.has(agentId) && !agent.archivedAt ? "true" : "false";
    const current = agent.labels[input.label] === "true" ? "true" : "false";
    if (current === value) continue;
    if (input.pending?.has(`${agentId}:${value}`)) continue;
    writes.push({ agentId, value });
  }
  return writes;
}
