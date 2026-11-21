// CUSTOM(pm-sidebar): the Desk header's Project Manager button shows once there is a chat to open
// (remembered, or any agent labeled as the chat) or the assistant Desk exists.
import { useMemo } from "react";
import { useSessionStore } from "@/stores/session-store";
import { ASSISTANT_DESK_ID, useDesksStore } from "@/task-navigation/desks-store";
import { hasAssistantChat } from "./model";
import { assistantAgentMaps } from "./session-agent-maps";
import { useAssistantSidebarStore } from "./store";

export function useHasAssistantChat(): boolean {
  const remembered = useAssistantSidebarStore((state) => state.chat);
  const maps = useSessionStore((state) => assistantAgentMaps(state.sessions));
  const hasDesk = useDesksStore((state) =>
    state.desks.some((desk) => desk.id === ASSISTANT_DESK_ID),
  );
  const hasChat = useMemo(
    () => hasAssistantChat({ remembered, agentsByServer: maps.agentsByServer }),
    [maps, remembered],
  );
  return hasDesk || hasChat;
}
