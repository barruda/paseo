// CUSTOM(task-archived-list): archived sessions for the Tasks sidebar's Archived filter. Agent
// history pages them from every host; sessions archived in this app session join immediately.
import { useMemo } from "react";
import equal from "fast-deep-equal";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { isBoardAgent } from "@getpaseo/protocol/board-agents";
import { useAgentHistory } from "@/hooks/use-agent-history";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { isBoardAgentInSession } from "@/board-agents/visibility"; // CUSTOM(hidden-board-agents)
import { useSessionStore } from "@/stores/session-store";
import { buildTaskTree, taskKey, type TaskAgent, type TaskNode, type TaskWorkspace } from "./model";

export interface ArchivedEntry {
  serverId: string;
  id: string;
  workspaceId?: string | null;
  title: string | null;
  provider: string;
  status: TaskAgent["status"];
  archivedAt: Date;
  /** CUSTOM(hidden-board-agents): started by the Power Workboard or the Projects Assistant. */
  board: boolean;
}

function toTaskAgent(entry: ArchivedEntry): TaskAgent {
  return {
    serverId: entry.serverId,
    id: entry.id,
    workspaceId: entry.workspaceId ?? undefined,
    title: entry.title,
    provider: entry.provider,
    model: null,
    status: entry.status,
    running: false,
    pendingPermissionCount: 0,
    requiresAttention: false,
    attentionReason: null,
    // Archived crews stay flat: a parent may be archived at a different time than its children.
    parentAgentId: null,
    updatedAt: entry.archivedAt,
  };
}

function selectArchivedInSession(state: ReturnType<typeof useSessionStore.getState>) {
  const result: ArchivedEntry[] = [];
  for (const [serverId, session] of Object.entries(state.sessions)) {
    for (const agent of session.agents.values()) {
      if (!agent.archivedAt) continue;
      result.push({
        serverId,
        id: agent.id,
        workspaceId: agent.workspaceId,
        title: agent.title,
        provider: agent.provider,
        status: agent.status,
        archivedAt: agent.archivedAt,
        board: isBoardAgentInSession(agent, session.agents, session.agentDetails),
      });
    }
  }
  return result;
}

const NO_ENTRIES: ArchivedEntry[] = [];

/**
 * History pages and sessions archived in this app session, one per agent, newest wins from the
 * session. CUSTOM(hidden-board-agents): board agents stay out unless `includeBoardAgents`; a
 * history entry's parent chain is resolved against the other history entries of its host.
 */
export function mergeArchivedAgents(input: {
  historyAgents: readonly AggregatedAgent[];
  sessionArchived: readonly ArchivedEntry[];
  includeBoardAgents: boolean;
}): TaskAgent[] {
  const { historyAgents, sessionArchived, includeBoardAgents } = input;
  const historyLabels = new Map<string, Record<string, string> | undefined>();
  for (const agent of historyAgents)
    historyLabels.set(taskKey(agent.serverId, agent.id), agent.labels);
  const byKey = new Map<string, TaskAgent>();
  for (const agent of historyAgents) {
    if (!agent.archivedAt) continue;
    const key = taskKey(agent.serverId, agent.id);
    const board = isBoardAgent(agent.labels, (id) =>
      historyLabels.get(taskKey(agent.serverId, id)),
    );
    if (board && !includeBoardAgents) continue;
    byKey.set(key, toTaskAgent({ ...agent, archivedAt: agent.archivedAt, board }));
  }
  for (const entry of sessionArchived) {
    const key = taskKey(entry.serverId, entry.id);
    if (entry.board && !includeBoardAgents) {
      byKey.delete(key);
      continue;
    }
    byKey.set(key, toTaskAgent(entry));
  }
  return [...byKey.values()];
}

export interface ArchivedTasks {
  roots: TaskNode[];
  /** False until the first history page arrives. */
  loaded: boolean;
  hasMore: boolean;
  isLoadingMore: boolean;
  loadMore: () => void;
}

export function useArchivedTasks(
  enabled: boolean,
  workspaces: readonly TaskWorkspace[],
  includeBoardAgents: boolean, // CUSTOM(hidden-board-agents)
): ArchivedTasks {
  // CUSTOM(history-archived-tab): ask the daemon for archived sessions only.
  const history = useAgentHistory({ enabled, view: "archived" });
  const sessionArchived = useStoreWithEqualityFn(
    useSessionStore,
    (state) => (enabled ? selectArchivedInSession(state) : NO_ENTRIES),
    equal,
  );
  const historyAgents = history.agents;
  const roots = useMemo(() => {
    if (!enabled) return [];
    const agents = mergeArchivedAgents({ historyAgents, sessionArchived, includeBoardAgents });
    return buildTaskTree({ agents, workspaces }).sort(
      (a, b) =>
        b.agent.updatedAt.getTime() - a.agent.updatedAt.getTime() || a.key.localeCompare(b.key),
    );
  }, [enabled, historyAgents, sessionArchived, workspaces, includeBoardAgents]);
  return {
    roots,
    loaded: enabled && !history.isInitialLoad,
    hasMore: history.hasMore,
    isLoadingMore: history.isLoadingMore,
    loadMore: history.loadMore,
  };
}
