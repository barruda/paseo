// CUSTOM(assistant-desk-newest): the archived callout asks whether a newer live chat replaces the
// archived assistant chat it shows.
import { useMemo } from "react";
import { useSessionStore } from "@/stores/session-store";
import { newerAssistantChat, type AssistantChatRef } from "./model";
import { assistantAgentMaps } from "./session-agent-maps";

/** The live chat to go to (and whether it came from a compaction), or null. */
export function useNewerAssistantChat(
  serverId: string,
  agentId: string,
): { chat: AssistantChatRef; compacted: boolean } | null {
  // assistantAgentMaps returns the same snapshot until an agents map is replaced.
  const maps = useSessionStore((state) => assistantAgentMaps(state.sessions));
  // The agents map lists only live agents; an archived one is in the agent details.
  const agent = useSessionStore((state) => {
    const session = state.sessions[serverId];
    return session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
  });
  return useMemo(
    () =>
      newerAssistantChat({
        serverId,
        agentId,
        agent,
        agentsByServer: maps.agentsByServer,
        hydratedServerIds: maps.hydratedServerIds,
      }),
    [maps, agent, serverId, agentId],
  );
}
