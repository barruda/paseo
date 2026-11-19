// CUSTOM(agent-successor): an agent created with AGENT_REPLACES_LABEL takes over from the agent it
// names. When that agent is archived while the app watches, its open tabs switch to the
// successor and its composer draft moves along. The Projects Assistant compaction
// (custom/plugins/power-workboard, CUSTOM(assistant-compact)) uses it to keep the chat tab on the
// live chat. Labels are free-form, so this needs no protocol field.

/** Label value: the id of the agent this one replaces. */
export const AGENT_REPLACES_LABEL = "paseo.replaces-agent";

interface SuccessorCandidate {
  labels?: Readonly<Record<string, string>>;
  archivedAt?: Date | null;
  workspaceId?: string | null;
}

export interface AgentSuccessorFollow {
  serverId: string;
  fromAgentId: string;
  toAgentId: string;
  /** The successor's workspace, when the session knows it. */
  toWorkspaceId: string | null;
}

/** The live agent that names `agentId` in AGENT_REPLACES_LABEL, if any. */
export function findAgentSuccessor(
  agents: ReadonlyMap<string, SuccessorCandidate>,
  agentId: string,
): { agentId: string; workspaceId: string | null } | null {
  for (const [id, agent] of agents) {
    if (id === agentId || agent.archivedAt) continue;
    if (agent.labels?.[AGENT_REPLACES_LABEL] === agentId) {
      return { agentId: id, workspaceId: agent.workspaceId ?? null };
    }
  }
  return null;
}

/**
 * Splits `serverId:agentId` keys of newly archived agents (see detectNewlyArchived) into the
 * ones a successor takes over and the rest.
 */
export function planAgentSuccessorFollows(
  newlyArchived: readonly string[],
  agentsByServer: ReadonlyMap<string, ReadonlyMap<string, SuccessorCandidate>>,
): { follows: AgentSuccessorFollow[]; rest: string[] } {
  const follows: AgentSuccessorFollow[] = [];
  const rest: string[] = [];
  for (const key of newlyArchived) {
    const split = key.indexOf(":");
    const serverId = key.slice(0, split);
    const fromAgentId = key.slice(split + 1);
    const agents = agentsByServer.get(serverId);
    const successor = agents ? findAgentSuccessor(agents, fromAgentId) : null;
    if (successor) {
      follows.push({
        serverId,
        fromAgentId,
        toAgentId: successor.agentId,
        toWorkspaceId: successor.workspaceId,
      });
    } else {
      rest.push(key);
    }
  }
  return { follows, rest };
}

export interface DraftContent {
  text: string;
  attachments: readonly unknown[];
}

/**
 * The draft the successor should get: the old agent's, unless the successor already has one or
 * the old one is empty.
 */
export function draftToCarry<T extends DraftContent>(
  from: T | undefined,
  to: T | undefined,
): T | null {
  if (!from || (!from.text.trim() && from.attachments.length === 0)) return null;
  if (to && (to.text.trim() || to.attachments.length > 0)) return null;
  return from;
}
