// CUSTOM(assistant-sidebar): every way to the Projects Assistant chat ends here. It records the
// request and shows the last workspace's route, where the Desk (Tasks mode) or the workspace
// screen reveals the sidebar tab (reveal.ts).
import { navigateToHostWorkspaceRoute } from "@/navigation/workspace-route-navigation";
import { getLastWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import { useDeskWorkboardStore } from "@/task-navigation/desk-workboard-store";
import { buildHostWorkspaceRoute } from "@/utils/host-routes";
import { isLiveAssistantChatAgent, resolveAssistantChat, type AssistantChatRef } from "./model";
import { assistantAgentMaps } from "./session-agent-maps";
import { useAssistantSidebarStore } from "./store";

function sessionAgent(serverId: string, agentId: string) {
  const session = useSessionStore.getState().sessions[serverId];
  return session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
}

/**
 * Whether the session knows this agent as a live Projects Assistant chat. An archived chat is
 * left to ordinary navigation: asking the sidebar for it would swap in whatever live chat
 * replaced it.
 */
export function isAssistantChatInSession(serverId: string, agentId: string): boolean {
  const agent = sessionAgent(serverId, agentId);
  return isLiveAssistantChatAgent(agent);
}

/** The chat the sidebar tab shows right now; see resolveAssistantChat. */
export function currentAssistantChat(preferredServerId: string | null): AssistantChatRef | null {
  const { agentsByServer, hydratedServerIds } = assistantAgentMaps(
    useSessionStore.getState().sessions,
  );
  return resolveAssistantChat({
    remembered: useAssistantSidebarStore.getState().chat,
    agentsByServer,
    preferredServerId,
    hydratedServerIds,
  });
}

/**
 * Shows the Projects Assistant tab in the sidebar of the Desk or workspace on screen, opening the
 * sidebar when it is closed. `chat` is the chat to show; null keeps the remembered one.
 */
export function openAssistantSidebar(input: {
  chat: AssistantChatRef | null;
  focusComposer?: boolean;
}): string {
  const chatWorkspaceId = input.chat
    ? sessionAgent(input.chat.serverId, input.chat.agentId)?.workspaceId
    : undefined;
  const last =
    getLastWorkspaceSelection() ??
    (input.chat && chatWorkspaceId
      ? { serverId: input.chat.serverId, workspaceId: chatWorkspaceId }
      : null);
  // Nothing to show it in: remember the chat, but leave no reveal request behind for whatever
  // screen happens to take the focus next.
  if (!last) {
    if (input.chat) useAssistantSidebarStore.getState().setChat(input.chat);
    return "";
  }
  useAssistantSidebarStore.getState().request(input.chat, input.focusComposer ?? true);
  // The board covers the Desk and its sidebar.
  useDeskWorkboardStore.getState().deselect();
  const route = buildHostWorkspaceRoute(last.serverId, last.workspaceId);
  navigateToHostWorkspaceRoute(route);
  return route;
}
