// CUSTOM(task-archived-list): archived sessions for the Tasks sidebar's Archived filter. Agent
// history pages them from every host; sessions archived in this app session join immediately.
import { useMemo } from "react";
import equal from "fast-deep-equal";
import { useStoreWithEqualityFn } from "zustand/traditional";
import { useAgentHistory } from "@/hooks/use-agent-history";
import { useSessionStore } from "@/stores/session-store";
import { buildTaskTree, taskKey, type TaskAgent, type TaskNode, type TaskWorkspace } from "./model";

interface ArchivedEntry {
  serverId: string;
  id: string;
  workspaceId?: string | null;
  title: string | null;
  provider: string;
  status: TaskAgent["status"];
  archivedAt: Date;
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
      });
    }
  }
  return result;
}

const NO_ENTRIES: ArchivedEntry[] = [];

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
): ArchivedTasks {
  const history = useAgentHistory({ enabled });
  const sessionArchived = useStoreWithEqualityFn(
    useSessionStore,
    (state) => (enabled ? selectArchivedInSession(state) : NO_ENTRIES),
    equal,
  );
  const historyAgents = history.agents;
  const roots = useMemo(() => {
    if (!enabled) return [];
    const byKey = new Map<string, TaskAgent>();
    for (const agent of historyAgents) {
      if (!agent.archivedAt) continue;
      byKey.set(
        taskKey(agent.serverId, agent.id),
        toTaskAgent({ ...agent, archivedAt: agent.archivedAt }),
      );
    }
    for (const entry of sessionArchived)
      byKey.set(taskKey(entry.serverId, entry.id), toTaskAgent(entry));
    return buildTaskTree({ agents: [...byKey.values()], workspaces }).sort(
      (a, b) =>
        b.agent.updatedAt.getTime() - a.agent.updatedAt.getTime() || a.key.localeCompare(b.key),
    );
  }, [enabled, historyAgents, sessionArchived, workspaces]);
  return {
    roots,
    loaded: enabled && !history.isInitialLoad,
    hasMore: history.hasMore,
    isLoadingMore: history.isLoadingMore,
    loadMore: history.loadMore,
  };
}
