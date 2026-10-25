// CUSTOM(btw-actions): the chat's branch button for a plugin card. The branch carries the
// agent's whole chat history plus the card's own text (`extraContext`).
import { useCallback } from "react";
import type { AgentForkMenuProps } from "@getpaseo/plugin/client/react-native";
import { AssistantForkMenu, type AssistantForkTarget } from "@/components/assistant-fork-menu";
import { useToast } from "@/contexts/toast-context";
import { useForkAgent } from "@/hooks/use-fork-agent";
import { useSessionStore } from "@/stores/session-store";

export function AgentForkMenu({ serverId, agentId, extraContext, testID }: AgentForkMenuProps) {
  const toast = useToast();
  const agent = useSessionStore((state) => state.sessions[serverId]?.agents.get(agentId) ?? null);
  const forkAgent = useForkAgent({ serverId, toast });
  const handleFork = useCallback(
    async (target: AssistantForkTarget) => {
      if (!agent) return;
      await forkAgent({
        agentId,
        agent,
        workspaceId: agent.workspaceId,
        target,
        extraContext: extraContext(),
      });
    },
    [agent, agentId, extraContext, forkAgent],
  );
  if (!agent) return null;
  return <AssistantForkMenu onFork={handleFork} testID={testID} />;
}
