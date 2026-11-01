// CUSTOM(git-sync): polls the shell-command plugin's `git-sync` RPC for the agent's checkout while
// its composer is mounted. Null when the agent's host lacks the plugin (or an older one without the
// RPC), so the chips stay hidden there.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isWeb } from "@/constants/platform";
import { usePluginClientSlashCommands } from "@/plugins/client-slash-commands";
import { BANG_COMMAND_NAME } from "@/plugins/client-slash-commands/model";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { GIT_SYNC_RPC, gitSyncStatusSchema, type GitSyncStatus } from "./model";

const POLL_MS = 5_000;
/** After a chip runs a merge, look again soon so the row follows it without waiting 5 s. */
const FOLLOW_UP_DELAYS_MS = [1_000, 2_500];

export interface GitSync {
  status: GitSyncStatus | null;
  /** Reads the status again now, and twice more over the next seconds. */
  refresh: () => void;
}

export function useGitSync(input: {
  serverId: string;
  workspaceId: string;
  agentId: string;
}): GitSync {
  const { serverId, workspaceId, agentId } = input;
  const commands = usePluginClientSlashCommands({ serverId, workspaceId, agentId });
  const pluginId = useMemo(
    () => commands.find((command) => command.name === BANG_COMMAND_NAME)?.pluginId ?? null,
    [commands],
  );
  const cwd = useSessionStore((state) => state.sessions[serverId]?.agents?.get(agentId)?.cwd ?? "");
  const client = useHostRuntimeClient(serverId);
  const [status, setStatus] = useState<GitSyncStatus | null>(null);
  const lastJsonRef = useRef("null");
  const pollRef = useRef<() => void>(() => {});
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    let cancelled = false;
    let inFlight = false;
    const apply = (next: GitSyncStatus | null) => {
      const json = JSON.stringify(next);
      if (cancelled || json === lastJsonRef.current) return;
      lastJsonRef.current = json;
      setStatus(next);
    };
    if (!pluginId || !cwd || !client) {
      apply(null);
      pollRef.current = () => {};
      return undefined;
    }
    const poll = () => {
      if (inFlight || (isWeb && typeof document !== "undefined" && document.hidden)) return;
      inFlight = true;
      client
        .invokePluginRpc(pluginId, GIT_SYNC_RPC, { cwd })
        .then((response) => apply(gitSyncStatusSchema.parse(response)))
        .catch(() => apply(null))
        .finally(() => {
          inFlight = false;
        });
    };
    pollRef.current = poll;
    poll();
    const interval = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
      pollRef.current = () => {};
    };
  }, [client, cwd, pluginId]);

  useEffect(
    () => () => {
      for (const timer of timersRef.current) clearTimeout(timer);
    },
    [],
  );

  const refresh = useCallback(() => {
    for (const timer of timersRef.current) clearTimeout(timer);
    pollRef.current();
    timersRef.current = FOLLOW_UP_DELAYS_MS.map((delay) =>
      setTimeout(() => pollRef.current(), delay),
    );
  }, []);

  return useMemo(() => ({ status, refresh }), [status, refresh]);
}
