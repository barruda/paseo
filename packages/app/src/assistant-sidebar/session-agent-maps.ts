// CUSTOM(assistant-sidebar): the session store updates many times a second while agents stream.
// The panel and open.ts only need the timestamp-free agent facts, so rebuild the per-server
// snapshot only when an agents map (or its hydration flag) was replaced, like the sweep does.
import type { SessionState } from "@/stores/session-store";
import type { AssistantAgentFacts } from "./model";

export interface AssistantAgentMaps {
  agentsByServer: Map<string, ReadonlyMap<string, AssistantAgentFacts>>;
  hydratedServerIds: Set<string>;
}

/** One cache per caller: the app shares one, a test makes its own. */
export function createAssistantAgentMapsCache(): (
  sessions: Record<string, SessionState>,
) => AssistantAgentMaps {
  let lastKeys: unknown[] | null = null;
  let lastMaps: AssistantAgentMaps | null = null;
  return (sessions) => {
    const serverIds = Object.keys(sessions);
    const keys = serverIds.flatMap((serverId) => [
      sessions[serverId]?.agents,
      sessions[serverId]?.hasHydratedAgents,
    ]);
    if (
      lastMaps &&
      lastKeys &&
      keys.length === lastKeys.length &&
      keys.every((key, index) => key === lastKeys![index])
    ) {
      return lastMaps;
    }
    const agentsByServer = new Map<string, ReadonlyMap<string, AssistantAgentFacts>>();
    const hydratedServerIds = new Set<string>();
    for (const serverId of serverIds) {
      const session = sessions[serverId];
      if (!session) continue;
      agentsByServer.set(serverId, session.agents);
      if (session.hasHydratedAgents) hydratedServerIds.add(serverId);
    }
    lastKeys = keys;
    lastMaps = { agentsByServer, hydratedServerIds };
    return lastMaps;
  };
}

export const assistantAgentMaps = createAssistantAgentMapsCache();
