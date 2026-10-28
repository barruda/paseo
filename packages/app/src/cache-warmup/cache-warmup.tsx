import { useEffect } from "react";
import { useDesksStore } from "@/task-navigation/desks-store";
import { useSessionStore } from "@/stores/session-store";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import type { WorkspaceLayout } from "@/stores/workspace-layout-actions";
import { generateMessageId } from "@/types/stream";
import { CACHE_WARMUP_MESSAGE, pickAgentsToWarm, type CacheWarmupCandidate } from "./model";

// CUSTOM(cache-warmup): checks every 30 s and pings the sessions `pickAgentsToWarm` returns. A tab
// in any workspace or Desk counts as open. Other windows or devices showing the same agent see its
// activity move after the first ping and skip it.

const CHECK_INTERVAL_MS = 30_000;

function collectOpenAgentIds(): Set<string> {
  const layouts: WorkspaceLayout[] = [
    ...Object.values(useWorkspaceLayoutStore.getState().layoutByWorkspace),
    ...useDesksStore.getState().desks.map((desk) => desk.layout),
  ];
  const ids = new Set<string>();
  for (const layout of layouts) {
    for (const tab of collectAllTabs(layout.root)) {
      if (tab.target.kind === "agent") ids.add(tab.target.agentId);
    }
  }
  return ids;
}

function collectCandidates(): CacheWarmupCandidate[] {
  const candidates: CacheWarmupCandidate[] = [];
  const state = useSessionStore.getState();
  for (const [serverId, session] of Object.entries(state.sessions)) {
    for (const agent of session.agents.values()) {
      if (agent.archivedAt) continue;
      // The live stream moves this slice; the snapshot's time can lag behind it.
      const streamedActivity = state.agentLastActivity.get(agent.id)?.getTime() ?? 0;
      candidates.push({
        serverId,
        agentId: agent.id,
        provider: agent.provider,
        status: agent.status,
        contextTokens: agent.lastUsage?.contextWindowUsedTokens ?? null,
        lastActivityAt: Math.max(agent.lastActivityAt.getTime(), streamedActivity),
      });
    }
  }
  return candidates;
}

/** The activity time each agent was last pinged for, so one idle stretch gets one ping. */
const pingedAt = new Map<string, number>();

function warmIdleSessions(): void {
  const due = pickAgentsToWarm({
    candidates: collectCandidates(),
    openAgentIds: collectOpenAgentIds(),
    now: Date.now(),
  });
  for (const agent of due) {
    const key = `${agent.serverId}\u0000${agent.agentId}`;
    if (pingedAt.get(key) === agent.lastActivityAt) continue;
    const client = useSessionStore.getState().sessions[agent.serverId]?.client;
    if (!client) continue;
    pingedAt.set(key, agent.lastActivityAt);
    void client
      .sendAgentMessage(agent.agentId, CACHE_WARMUP_MESSAGE, { messageId: generateMessageId() })
      .catch((error: unknown) => {
        console.warn("[cache-warmup] ping failed", agent.agentId, error);
      });
  }
}

export function CacheWarmup(): null {
  useEffect(() => {
    const interval = setInterval(warmIdleSessions, CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, []);
  return null;
}
