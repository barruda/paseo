import { useEffect } from "react";
import { useDesksStore } from "@/task-navigation/desks-store";
import { useSessionStore, type SessionState } from "@/stores/session-store";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import type { WorkspaceLayout } from "@/stores/workspace-layout-actions";
import { generateMessageId } from "@/types/stream";
import {
  CACHE_WARMUP_MESSAGE,
  cacheLastUsedAt,
  cacheWarmupAgentKey,
  pickAgentsToWarm,
  type CacheWarmupCandidate,
} from "./model";
import { useCacheWarmupStore } from "./store";

// CUSTOM(cache-warmup): checks every 30 s and pings the sessions `pickAgentsToWarm` returns. A tab
// in any workspace or Desk counts as open. Other windows or devices showing the same agent see its
// activity move after the first ping and skip it. It also records when each agent's turn starts or
// ends, which `cacheLastUsedAt` counts as a cache use.

const CHECK_INTERVAL_MS = 30_000;

type Sessions = Record<string, SessionState>;

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
  const sessions = useSessionStore.getState().sessions;
  const lastTurnSeenAt = useCacheWarmupStore.getState().lastTurnSeenAt;
  for (const [serverId, session] of Object.entries(sessions)) {
    for (const agent of session.agents.values()) {
      if (agent.archivedAt) continue;
      candidates.push({
        serverId,
        agentId: agent.id,
        provider: agent.provider,
        status: agent.status,
        contextTokens: agent.lastUsage?.contextWindowUsedTokens ?? null,
        lastCacheUseAt: cacheLastUsedAt({
          lastUserMessageAt: agent.lastUserMessageAt?.getTime() ?? null,
          lastTurnSeenAt: lastTurnSeenAt[cacheWarmupAgentKey(serverId, agent.id)] ?? null,
        }),
      });
    }
  }
  return candidates;
}

/** Keys of agents whose status went into or out of "running" between the two session maps. */
function collectTurnChanges(sessions: Sessions, previous: Sessions | null): string[] {
  const keys: string[] = [];
  for (const [serverId, session] of Object.entries(sessions)) {
    const previousAgents = previous?.[serverId]?.agents;
    if (previousAgents === session.agents) continue;
    for (const agent of session.agents.values()) {
      const previousStatus = previousAgents?.get(agent.id)?.status;
      if (previousStatus === agent.status) continue;
      if (agent.status === "running" || previousStatus === "running") {
        keys.push(cacheWarmupAgentKey(serverId, agent.id));
      }
    }
  }
  return keys;
}

function recordTurns(sessions: Sessions, previous: Sessions | null) {
  if (sessions === previous) return;
  useCacheWarmupStore
    .getState()
    .recordTurnsSeen(collectTurnChanges(sessions, previous), Date.now());
}

/** The cache use time each agent was last pinged for, so one idle stretch gets one ping. */
const pingedAt = new Map<string, number | null>();

function warmIdleSessions(): void {
  const due = pickAgentsToWarm({
    candidates: collectCandidates(),
    openAgentIds: collectOpenAgentIds(),
    disabledAgentKeys: new Set(useCacheWarmupStore.getState().disabledAgentKeys),
    now: Date.now(),
  });
  for (const agent of due) {
    const key = cacheWarmupAgentKey(agent.serverId, agent.agentId);
    if (pingedAt.get(key) === agent.lastCacheUseAt) continue;
    const client = useSessionStore.getState().sessions[agent.serverId]?.client;
    if (!client) continue;
    pingedAt.set(key, agent.lastCacheUseAt);
    void client
      .sendAgentMessage(agent.agentId, CACHE_WARMUP_MESSAGE, { messageId: generateMessageId() })
      .catch((error: unknown) => {
        console.warn("[cache-warmup] ping failed", agent.agentId, error);
      });
  }
}

export function CacheWarmup(): null {
  useEffect(() => {
    recordTurns(useSessionStore.getState().sessions, null);
    const unsubscribe = useSessionStore.subscribe((state, previous) =>
      recordTurns(state.sessions, previous.sessions),
    );
    const interval = setInterval(warmIdleSessions, CHECK_INTERVAL_MS);
    return () => {
      unsubscribe();
      clearInterval(interval);
    };
  }, []);
  return null;
}
