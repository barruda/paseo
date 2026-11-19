// CUSTOM(assistant-cards): only the newest reply card of a chat takes one-tap answers and item
// comments, so an old answer is not sent again after a reload. Each card notes its time per chat;
// the newest time ever seen wins, so an older card that mounts later (scrolling up) stays read-only.
import { useEffect, useSyncExternalStore } from "react";

const newest = new Map<string, number>();
const listeners = new Set<() => void>();

/** Records a reply's time; returns whether it is now the chat's newest. */
export function noteReply(agentId: string, time: number): boolean {
  const current = newest.get(agentId);
  if (current !== undefined && current > time) return false;
  if (current !== time) {
    newest.set(agentId, time);
    for (const listener of listeners) listener();
  }
  return true;
}

/** Whether a reply at `time` is the newest the chat has shown. */
export function isNewestReply(agentId: string, time: number): boolean {
  const current = newest.get(agentId);
  return current === undefined || current <= time;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** For tests. */
export function resetNewestReplies(): void {
  newest.clear();
}

export function useIsNewestReply(agentId: string, time: number): boolean {
  useEffect(() => {
    noteReply(agentId, time);
  }, [agentId, time]);
  return useSyncExternalStore(
    subscribe,
    () => isNewestReply(agentId, time),
    () => isNewestReply(agentId, time),
  );
}
