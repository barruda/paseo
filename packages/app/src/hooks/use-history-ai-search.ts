import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import { useFetchQuery } from "@/data/query";
import type { AggregatedAgent } from "@/hooks/use-aggregated-agents";
import { toAggregatedHistoryAgents } from "@/hooks/use-agent-history";
import { getHostRuntimeStore, isHostRuntimeConnected, useHosts } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";

// CUSTOM(history-ai-search): History search by question. Each host's metadata model picks
// sessions from its own History; the screen lists them best first with the model's reason.

export interface HistoryAiSearchHostOutcome {
  serverId: string;
  serverLabel: string;
  queries: string[];
  since: string | null;
  until: string | null;
  error: string | null;
}

export type HistoryAiSearchState =
  | { status: "idle" }
  | { status: "searching" }
  | { status: "error"; error: string }
  | { status: "done"; agents: AggregatedAgent[]; hosts: HistoryAiSearchHostOutcome[] };

export interface HistoryAiSearchResult {
  state: HistoryAiSearchState;
  /** False when a target host predates AI search; the screen hides the field. */
  isSupported: boolean;
  /** A question was submitted: its results replace the History list. */
  isActive: boolean;
  submit: (question: string) => void;
  clear: () => void;
  retry: () => void;
}

interface AiSearchHost {
  serverId: string;
  serverLabel: string;
  client: NonNullable<ReturnType<ReturnType<typeof getHostRuntimeStore>["getClient"]>>;
}

/** Interleaves each host's ranked list so no host's best pick sinks below another's tail. */
function interleave(lists: AggregatedAgent[][]): AggregatedAgent[] {
  const merged: AggregatedAgent[] = [];
  const longest = Math.max(0, ...lists.map((list) => list.length));
  for (let position = 0; position < longest; position += 1) {
    for (const list of lists) {
      const agent = list[position];
      if (agent) merged.push(agent);
    }
  }
  return merged;
}

async function searchHosts(
  hosts: readonly AiSearchHost[],
  question: string,
): Promise<Extract<HistoryAiSearchState, { status: "done" }>> {
  const settled = await Promise.allSettled(
    hosts.map(async (host) => ({ host, payload: await host.client.searchHistoryWithAi(question) })),
  );
  const lists: AggregatedAgent[][] = [];
  const outcomes: HistoryAiSearchHostOutcome[] = [];
  settled.forEach((result, position) => {
    const host = hosts[position];
    if (result.status === "rejected") {
      const error = result.reason instanceof Error ? result.reason.message : String(result.reason);
      outcomes.push({
        serverId: host.serverId,
        serverLabel: host.serverLabel,
        queries: [],
        since: null,
        until: null,
        error,
      });
      return;
    }
    const { payload } = result.value;
    const reasons = new Map(payload.results.map((item) => [item.entry.agent.id, item.reason]));
    const order = new Map(payload.results.map((item, index) => [item.entry.agent.id, index]));
    const agents = toAggregatedHistoryAgents({
      serverId: host.serverId,
      entries: payload.results.map((item) => item.entry),
    })
      .map((agent) =>
        Object.assign({}, agent, {
          serverLabel: host.serverLabel,
          aiReason: reasons.get(agent.id),
        }),
      )
      .sort((left, right) => (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0));
    lists.push(agents);
    outcomes.push({
      serverId: host.serverId,
      serverLabel: host.serverLabel,
      queries: payload.queries,
      since: payload.since,
      until: payload.until,
      error: payload.error,
    });
  });
  return { status: "done", agents: interleave(lists), hosts: outcomes };
}

export function useHistoryAiSearch(options: {
  serverId: string | null;
  /** CUSTOM(history-search-tabs): an AI History search tab starts with its question submitted. */
  initialQuestion?: string;
}): HistoryAiSearchResult {
  const [submitted, setSubmitted] = useState(options.initialQuestion ?? "");
  const clear = useCallback(() => setSubmitted(""), []);
  const daemons = useHosts();
  const runtime = getHostRuntimeStore();
  const runtimeVersion = useSyncExternalStore(
    (onStoreChange) => runtime.subscribeAll(onStoreChange),
    () => runtime.getVersion(),
    () => runtime.getVersion(),
  );
  const hosts = useMemo(() => {
    void runtimeVersion;
    const serverIds = options.serverId
      ? [options.serverId]
      : daemons.map((daemon) => daemon.serverId);
    return serverIds.flatMap((serverId): AiSearchHost[] => {
      const client = runtime.getClient(serverId);
      if (!client || !isHostRuntimeConnected(runtime.getSnapshot(serverId))) return [];
      const serverLabel = daemons.find((daemon) => daemon.serverId === serverId)?.label ?? serverId;
      return [{ serverId, serverLabel, client }];
    });
  }, [daemons, options.serverId, runtime, runtimeVersion]);
  const serverIds = useMemo(() => hosts.map((host) => host.serverId).sort(), [hosts]);
  const isSupported = useSessionStore(
    useCallback(
      (state) =>
        serverIds.length > 0 &&
        serverIds.every((id) => state.sessions[id]?.serverInfo?.features?.historyAiSearch === true),
      [serverIds],
    ),
  );
  const question = submitted.trim();
  const query = useFetchQuery({
    queryKey: ["historyAiSearch", ...serverIds, question],
    enabled: isSupported && question.length > 0,
    dataShape: "value",
    staleTimeMs: 5 * 60_000,
    retry: false,
    queryFn: () => searchHosts(hosts, question),
  });
  const { refetch } = query;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);

  const state = useMemo((): HistoryAiSearchState => {
    if (!question || !isSupported) return { status: "idle" };
    if (query.isFetching) return { status: "searching" };
    if (query.error) return { status: "error", error: query.error.message };
    return query.data ?? { status: "searching" };
  }, [isSupported, query.data, query.error, query.isFetching, question]);

  return {
    state,
    isSupported,
    isActive: isSupported && question.length > 0,
    submit: setSubmitted,
    clear,
    retry,
  };
}
