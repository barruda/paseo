// CUSTOM(jev-router): the agent session you were looking at last, so a new tab can tell what Jev
// changed relative to it ("from an Opus high session, the effort flashes"). The new tab's own
// starting selection can't tell: it comes from the saved preferences, which a routed session
// doesn't update.

import { useEffect } from "react";
import { useSessionStore } from "@/stores/session-store";

let lastViewed: { serverId: string; agentId: string } | null = null;

/** Called by the agent panel: the interactive (focused, visible) agent is the one being viewed. */
export function useRecordViewedAgent(serverId: string, agentId: string, isInteractive: boolean) {
  useEffect(() => {
    if (isInteractive) lastViewed = { serverId, agentId };
  }, [agentId, isInteractive, serverId]);
}

/** A focused draft is what you are looking at now: a tab opened from it has no session to compare. */
export function useRecordViewedDraft(isFocused: boolean) {
  useEffect(() => {
    if (isFocused) lastViewed = null;
  }, [isFocused]);
}

/** Model and effort of the Claude session last viewed on `serverId`, if any. */
export function readLastViewedClaudeSelection(
  serverId: string,
): { model: string; effort: string | null } | null {
  if (!lastViewed || lastViewed.serverId !== serverId) return null;
  const session = useSessionStore.getState().sessions[serverId];
  const agent =
    session?.agents?.get(lastViewed.agentId) ?? session?.agentDetails?.get(lastViewed.agentId);
  if (!agent || agent.provider !== "claude") return null;
  const model = agent.model ?? agent.runtimeInfo?.model ?? null;
  if (!model) return null;
  return { model, effort: agent.thinkingOptionId ?? agent.runtimeInfo?.thinkingOptionId ?? null };
}
