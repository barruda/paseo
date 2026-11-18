// CUSTOM(shell-row-loading): a timeline row asks whether its tool call started a background task
// that is still live. The selector returns a boolean, so only the rows whose answer changes
// re-render when the agent's background task list moves.
import { useSessionStore } from "@/stores/session-store";
import { isBackgroundToolCallActive } from "./presentation";

export function useIsBackgroundToolCallActive(input: {
  serverId: string | undefined;
  agentId: string | undefined;
  callId: string | undefined;
}): boolean {
  const { serverId, agentId, callId } = input;
  return useSessionStore((state) => {
    if (!serverId || !agentId || !callId) return false;
    return isBackgroundToolCallActive(
      state.sessions[serverId]?.agents.get(agentId)?.backgroundTasks,
      callId,
    );
  });
}
