import { router, type Href } from "expo-router";
import { buildAgentDeepLink } from "@getpaseo/protocol/agent-deep-link";
import { isEmbedMode } from "@/embed/embed-mode";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import { resolveNavigateToAgent, type NavigateToAgentInput } from "./resolve";
import { isAssistantChatInSession, openAssistantDesk } from "@/assistant-sidebar/open"; // CUSTOM(assistant-desk)

export type { NavigateToAgentInput } from "./resolve";

export function navigateToAgent(input: NavigateToAgentInput): string {
  // CUSTOM(agent-embed): an embedded page never routes; the desktop app handles paseo:// links.
  if (isEmbedMode()) {
    const link = buildAgentDeepLink({ serverId: input.serverId, agentId: input.agentId });
    window.open(link);
    return link;
  }
  // CUSTOM(assistant-desk): the Projects Assistant chat shows in its own Desk (Tasks mode). With
  // Tasks mode off openAssistantDesk returns null and ordinary navigation runs.
  if (input.assistantSidebar || isAssistantChatInSession(input.serverId, input.agentId)) {
    const route = openAssistantDesk({
      chat: { serverId: input.serverId, agentId: input.agentId },
    });
    if (route !== null) return route;
  }
  return resolveNavigateToAgent(input, {
    readAgentNavTarget: ({ serverId, agentId }) => {
      const session = useSessionStore.getState().sessions[serverId];
      const agent = session?.agents.get(agentId) ?? session?.agentDetails.get(agentId);
      return {
        agentWorkspaceId: agent?.workspaceId,
      };
    },
    navigateToHostAgent: (route) => {
      router.navigate(route as Href);
    },
    navigateToWorkspace,
  });
}
