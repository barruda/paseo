// CUSTOM(desk-archive-close): detects agents archived while a Desk was watching, so their tabs
// close the way the workspace layout closes them. An agent already archived at first sight keeps
// its tab: users open archived sessions on purpose.

export interface ArchiveTransitions {
  next: Map<string, boolean>;
  newlyArchived: string[];
}

/** `agentsByServer` holds only hydrated servers; others are neither recorded nor acted on. */
export function detectNewlyArchived(
  previous: ReadonlyMap<string, boolean>,
  agentsByServer: ReadonlyMap<string, ReadonlyMap<string, { archivedAt?: Date | null }>>,
): ArchiveTransitions {
  const next = new Map<string, boolean>();
  const newlyArchived: string[] = [];
  for (const [serverId, agents] of agentsByServer) {
    for (const [agentId, agent] of agents) {
      const key = `${serverId}:${agentId}`;
      const archived = Boolean(agent.archivedAt);
      next.set(key, archived);
      if (archived && previous.get(key) === false) newlyArchived.push(key);
    }
  }
  return { next, newlyArchived };
}
