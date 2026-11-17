// CUSTOM(idle-closed-tab): which agents this client has a tab open for, and which label writes
// tell the daemon so. The daemon releases an agent with no open tab sooner than one with a tab.

export interface OpenTabRef {
  serverId: string;
  agentId: string;
}

/**
 * Tabs of the active mode only. Tasks mode keeps ~15 stale tabs in the normal layout, and normal
 * mode keeps the Desks, so counting both would hold agents open that no one can see.
 */
export function selectOpenAgentIds(input: {
  tasksMode: boolean;
  deskTabs: readonly OpenTabRef[];
  layoutTabs: readonly OpenTabRef[];
}): Map<string, Set<string>> {
  const byServer = new Map<string, Set<string>>();
  for (const tab of input.tasksMode ? input.deskTabs : input.layoutTabs) {
    const ids = byServer.get(tab.serverId) ?? new Set<string>();
    ids.add(tab.agentId);
    byServer.set(tab.serverId, ids);
  }
  return byServer;
}

export interface IdleLabelWrite {
  agentId: string;
  value: "true" | "false";
}

/** Only agents whose label differs. A missing label means closed, so unopened agents get no write. */
export function getIdleLabelWrites(input: {
  label: string;
  openAgentIds: ReadonlySet<string>;
  agents: ReadonlyMap<
    string,
    { labels: Readonly<Record<string, string>>; archivedAt?: Date | null }
  >;
  pending?: ReadonlySet<string>;
}): IdleLabelWrite[] {
  const writes: IdleLabelWrite[] = [];
  for (const [agentId, agent] of input.agents) {
    if (agent.archivedAt) continue;
    const value = input.openAgentIds.has(agentId) ? "true" : "false";
    const current = agent.labels[input.label] === "true" ? "true" : "false";
    if (current === value) continue;
    if (input.pending?.has(`${agentId}:${value}`)) continue;
    writes.push({ agentId, value });
  }
  return writes;
}
