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
  return useMemo(
    () =>
      newerAssistantChat({
        serverId,
        agentId,
        agentsByServer: maps.agentsByServer,
        hydratedServerIds: maps.hydratedServerIds,
      }),
    [maps, serverId, agentId],
  );
}
