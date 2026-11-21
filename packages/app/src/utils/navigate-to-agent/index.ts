import { router, type Href } from "expo-router";
import { buildAgentDeepLink } from "@getpaseo/protocol/agent-deep-link";
import { isEmbedMode } from "@/embed/embed-mode";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useSessionStore } from "@/stores/session-store";
import { resolveNavigateToAgent, type NavigateToAgentInput } from "./resolve";
import { isAssistantChatInSession, openAssistantSidebar } from "@/assistant-sidebar/open"; // CUSTOM(assistant-desk), CUSTOM(pm-sidebar)

export type { NavigateToAgentInput } from "./resolve";

export function navigateToAgent(input: NavigateToAgentInput): string {
  // CUSTOM(agent-embed): an embedded page never routes; the desktop app handles paseo:// links.
  if (isEmbedMode()) {
    const link = buildAgentDeepLink({ serverId: input.serverId, agentId: input.agentId });
    window.open(link);
    return link;
  }
  // CUSTOM(assistant-desk), CUSTOM(pm-sidebar): the Project Manager chat shows in the right
  // sidebar (Tasks mode). With Tasks mode off openAssistantSidebar returns null and ordinary
  // navigation runs.
  if (input.assistantSidebar || isAssistantChatInSession(input.serverId, input.agentId)) {
    const route = openAssistantSidebar({
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
