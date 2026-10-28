import { useEffect } from "react";

// CUSTOM(chat-comments): each mounted composer registers how to append text to itself, keyed by
// the agent it writes to, so that agent's chat can drop a comment into it.
type AppendToComposer = (text: string) => void;

const composersByAgent = new Map<string, AppendToComposer[]>();

function agentKey(serverId: string, agentId: string): string {
  return `${serverId}\u0000${agentId}`;
}

function registerChatComposerAppend(
  serverId: string,
  agentId: string,
  append: AppendToComposer,
): () => void {
  const key = agentKey(serverId, agentId);
  const stack = composersByAgent.get(key) ?? [];
  stack.push(append);
  composersByAgent.set(key, stack);
  return () => {
    const current = composersByAgent.get(key);
    if (!current) return;
    const index = current.lastIndexOf(append);
    if (index >= 0) current.splice(index, 1);
    if (current.length === 0) composersByAgent.delete(key);
  };
}

/** Appends to the most recently mounted composer of the agent. False when there is none. */
export function appendToChatComposer(serverId: string, agentId: string, text: string): boolean {
  const stack = composersByAgent.get(agentKey(serverId, agentId));
  const append = stack?.[stack.length - 1];
  if (!append) return false;
  append(text);
  return true;
}

export function useRegisterChatComposerAppend(
  serverId: string,
  agentId: string,
  append: AppendToComposer,
): void {
  useEffect(
    () => registerChatComposerAppend(serverId, agentId, append),
    [agentId, append, serverId],
  );
}
