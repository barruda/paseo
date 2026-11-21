// CUSTOM(pm-chat-task-sync): the state of the tasks the chat's `seu` lines cite. Every reply on
// screen registers its ids; one query per host asks for all of them, so a long chat polls once
// every 5 s however many replies cite tasks.
import { useEffect, useSyncExternalStore } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { useRpc } from "@getpaseo/plugin/client";
import { assistantTaskStatesRpc } from "../../shared/assistant-rpc";
import { TASK_STATES_MAX } from "../../shared/reply-task-sync";

export const TASK_STATES_POLL_MS = 5_000;

/** How many mounted replies cite each id, by host. */
const cited = new Map<string, Map<string, number>>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

/** Adds the ids of one reply to the host's set; returns its removal. */
export function citeTaskIds(hostId: string, ids: readonly string[]) {
  const counts = cited.get(hostId) ?? new Map<string, number>();
  cited.set(hostId, counts);
  for (const id of ids) counts.set(id, (counts.get(id) ?? 0) + 1);
  notify();
  return () => {
    for (const id of ids) {
      const left = (counts.get(id) ?? 1) - 1;
      if (left > 0) counts.set(id, left);
      else counts.delete(id);
    }
    notify();
  };
}

/** The host's cited ids as a stable key: sorted, comma-joined, capped at what one call takes. */
export function citedTaskKey(hostId: string): string {
  const counts = cited.get(hostId);
  if (!counts) return "";
  return [...counts.keys()].sort().slice(0, TASK_STATES_MAX).join(",");
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export function taskStatesQueryKey(hostId: string, key: string) {
  return ["power-workboard", "task-states", hostId, key] as const;
}

/**
 * The states of `ids` (lowercased task refs) on the host, polled while any reply cites a task.
 * `data` is undefined until the first answer; `isError` is true when the host cannot answer.
 */
export function useCitedTaskStates(hostId: string, ids: readonly string[]) {
  const idsKey = ids.join(",");
  useEffect(() => {
    if (!idsKey) return;
    return citeTaskIds(hostId, idsKey.split(","));
  }, [hostId, idsKey]);
  const key = useSyncExternalStore(
    subscribe,
    () => citedTaskKey(hostId),
    () => citedTaskKey(hostId),
  );
  const callStates = useRpc(assistantTaskStatesRpc);
  return useQuery({
    queryKey: taskStatesQueryKey(hostId, key),
    queryFn: () => callStates({ ids: key.split(",") }),
    refetchInterval: TASK_STATES_POLL_MS,
    // A reply scrolling in or out changes the key; keep the last answer while the new one loads.
    placeholderData: keepPreviousData,
    enabled: idsKey !== "" && key !== "",
  });
}
