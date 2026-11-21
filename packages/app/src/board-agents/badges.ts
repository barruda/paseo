// CUSTOM(hidden-board-agents): the dock badge and the favicon ignore board agents. The daemon's
// workspace status counts every agent, so a workspace that holds board agents gets its status
// again here from its other agents, and one that holds only board agents drops out.
import {
  deriveAgentStateBucket,
  getWorkspaceStateBucketPriority,
  type WorkspaceStateBucket,
} from "@getpaseo/protocol/agent-state-bucket";
import type { Agent, WorkspaceDescriptor } from "@/stores/session-store";
import { isBoardAgentInSession } from "./visibility";

export interface BoardBadgeSession {
  workspaces: ReadonlyMap<string, WorkspaceDescriptor>;
  agents?: ReadonlyMap<string, Agent>;
  agentDetails?: ReadonlyMap<string, Agent>;
}

type BadgeAgent = Pick<
  Agent,
  "id" | "status" | "pendingPermissions" | "requiresAttention" | "attentionReason" | "parentAgentId"
>;

/** Same aggregation as the daemon: roots give their bucket, same-workspace children only "running". */
function statusFromAgents(agents: readonly BadgeAgent[]): WorkspaceStateBucket {
  const ids = new Set(agents.map((agent) => agent.id));
  let status: WorkspaceStateBucket = "done";
  for (const agent of agents) {
    const isRoot = !agent.parentAgentId || !ids.has(agent.parentAgentId);
    if (!isRoot && agent.status !== "running") continue;
    const bucket = isRoot
      ? deriveAgentStateBucket({
          status: agent.status,
          pendingPermissionCount: agent.pendingPermissions.length,
          requiresAttention: agent.requiresAttention,
          attentionReason: agent.attentionReason ?? null,
        })
      : "running";
    if (getWorkspaceStateBucketPriority(bucket) < getWorkspaceStateBucketPriority(status)) {
      status = bucket;
    }
  }
  return status;
}

/** One status per workspace that counts for the badge, with board agents left out. */
export function workspaceStatusesWithoutBoardAgents(
  session: BoardBadgeSession,
  includeWorkspace: (workspace: WorkspaceDescriptor) => boolean = () => true,
): WorkspaceStateBucket[] {
  const otherAgentsByWorkspace = new Map<string, Agent[]>();
  const boardWorkspaceIds = new Set<string>();
  for (const agent of session.agents?.values() ?? []) {
    if (agent.archivedAt || !agent.workspaceId) continue;
    if (isBoardAgentInSession(agent, session.agents, session.agentDetails)) {
      boardWorkspaceIds.add(agent.workspaceId);
      continue;
    }
    const list = otherAgentsByWorkspace.get(agent.workspaceId) ?? [];
    list.push(agent);
    otherAgentsByWorkspace.set(agent.workspaceId, list);
  }
  const statuses: WorkspaceStateBucket[] = [];
  for (const workspace of session.workspaces.values()) {
    if (!includeWorkspace(workspace)) continue;
    if (!boardWorkspaceIds.has(workspace.id)) {
      statuses.push(workspace.status);
      continue;
    }
    const others = otherAgentsByWorkspace.get(workspace.id);
    if (others) statuses.push(statusFromAgents(others));
  }
  return statuses;
}

interface SessionsWithAgents {
  sessions: Record<string, { agents: Map<string, Agent>; agentDetails: Map<string, Agent> }>;
}

export function boardAgentKey(serverId: string, agentId: string): string {
  return `${serverId}:${agentId}`;
}

/** Keys (`serverId:agentId`) of the board agents loaded in every session, sorted. */
export function selectBoardAgentKeys(state: SessionsWithAgents): string[] {
  const keys: string[] = [];
  for (const [serverId, session] of Object.entries(state.sessions)) {
    for (const agent of session.agents.values()) {
      if (isBoardAgentInSession(agent, session.agents, session.agentDetails)) {
        keys.push(boardAgentKey(serverId, agent.id));
      }
    }
  }
  return keys.sort();
}

/** Drops the agents whose key is in `boardKeys`; returns `agents` itself when there are none. */
export function withoutBoardAgents<T extends { serverId: string; id: string }>(
  agents: T[],
  boardKeys: readonly string[],
): T[] {
  if (boardKeys.length === 0) return agents;
  const board = new Set(boardKeys);
  return agents.filter((agent) => !board.has(boardAgentKey(agent.serverId, agent.id)));
}
