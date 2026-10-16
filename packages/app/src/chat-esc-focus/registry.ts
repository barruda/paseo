import { useEffect } from "react";

// CUSTOM(chat-esc-focus): each mounted composer registers how to focus itself, keyed by the
// agent it writes to, so the chat timeline of that agent can send focus back to it.
type FocusComposer = () => void;

const composersByAgent = new Map<string, FocusComposer[]>();

function agentKey(serverId: string, agentId: string): string {
  return `${serverId}\u0000${agentId}`;
}

export function registerChatComposerFocus(
  serverId: string,
  agentId: string,
  focus: FocusComposer,
): () => void {
  const key = agentKey(serverId, agentId);
  const stack = composersByAgent.get(key) ?? [];
  stack.push(focus);
  composersByAgent.set(key, stack);
  return () => {
    const current = composersByAgent.get(key);
    if (!current) return;
    const index = current.lastIndexOf(focus);
    if (index >= 0) current.splice(index, 1);
    if (current.length === 0) composersByAgent.delete(key);
  };
}

/** Focuses the most recently mounted composer of the agent. Returns false when there is none. */
export function focusChatComposer(serverId: string, agentId: string): boolean {
  const stack = composersByAgent.get(agentKey(serverId, agentId));
  const focus = stack?.[stack.length - 1];
  if (!focus) return false;
  focus();
  return true;
}

export function useRegisterChatComposerFocus(
  serverId: string,
  agentId: string,
  focus: FocusComposer,
): void {
  useEffect(() => registerChatComposerFocus(serverId, agentId, focus), [agentId, focus, serverId]);
}
