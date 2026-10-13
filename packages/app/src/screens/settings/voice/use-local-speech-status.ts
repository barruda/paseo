// CUSTOM(voice-settings): live status of the host's local speech engine, polled while
// Settings > Voice and dictation is open.
import { useMemo } from "react";
import type { SpeechLocalStatus } from "@getpaseo/protocol/speech-settings";

import { useFetchQuery } from "@/data/query";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";

const STATUS_REFRESH_MS = 2000;

export type LocalSpeechStatusState =
  | { status: "offline" }
  | { status: "unsupported" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; data: SpeechLocalStatus };

export function localSpeechStatusQueryKey(serverId: string, includeLogs: boolean) {
  return ["speech-local-status", serverId, includeLogs] as const;
}

export function useLocalSpeechStatus(
  serverId: string,
  options: { includeLogs: boolean; live: boolean },
): LocalSpeechStatusState {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const supported = useHostFeature(serverId, "speechSettings");
  const enabled = Boolean(client && isConnected && supported);

  const query = useFetchQuery<SpeechLocalStatus>({
    queryKey: useMemo(
      () => localSpeechStatusQueryKey(serverId, options.includeLogs),
      [serverId, options.includeLogs],
    ),
    queryFn: async () => {
      if (!client) throw new Error("Host disconnected");
      const payload = await client.getLocalSpeechStatus({ includeLogs: options.includeLogs });
      if (!payload.status) throw new Error(payload.error ?? "Speech status unavailable");
      return payload.status;
    },
    enabled,
    dataShape: "value",
    staleTimeMs: 0,
    refetchInterval: enabled && options.live ? STATUS_REFRESH_MS : false,
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
  });

  if (!isConnected || !client) return { status: "offline" };
  if (!supported) return { status: "unsupported" };
  if (query.data) return { status: "ready", data: query.data };
  if (query.error) return { status: "error", message: query.error.message };
  return { status: "loading" };
}
