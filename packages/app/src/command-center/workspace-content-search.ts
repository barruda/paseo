// CUSTOM(workspace-content-search): the command center's Search in files scope.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useHostFeature } from "@/runtime/host-features";
import { useSessionStore } from "@/stores/session-store";
import { useWorkspaceDirectory } from "@/stores/session-store-hooks";
import {
  errorMessage,
  openFileFromCommandCenter,
  useCommandCenterSearchWorkspace,
} from "./workspace-file-search";

const SEARCH_DEBOUNCE_MS = 200;

export interface WorkspaceContentMatch {
  path: string;
  line: number;
  text: string;
}

interface SearchState {
  requestKey: string | null;
  matches: readonly WorkspaceContentMatch[];
  truncated: boolean;
  loading: boolean;
  error: string | null;
}

const EMPTY_STATE: SearchState = {
  requestKey: null,
  matches: [],
  truncated: false,
  loading: false,
  error: null,
};

export function useWorkspaceContentSearch(input: { enabled: boolean; query: string }): {
  matches: readonly WorkspaceContentMatch[];
  truncated: boolean;
  loading: boolean;
  error: string | null;
  openMatch(match: WorkspaceContentMatch): void;
} {
  const { t } = useTranslation();
  const { serverId, workspaceId } = useCommandCenterSearchWorkspace();
  const cwd = useWorkspaceDirectory(serverId, workspaceId);
  const supported = useHostFeature(serverId, "workspaceContentSearch");
  const client = useSessionStore((state) =>
    serverId ? (state.sessions[serverId]?.client ?? null) : null,
  );
  const [state, setState] = useState<SearchState>(EMPTY_STATE);
  const query = input.query;
  const hasQuery = Boolean(query.trim());
  const searchable = input.enabled && supported && hasQuery && Boolean(client && cwd);
  const requestKey = useMemo(
    () => (searchable ? `${serverId}\0${workspaceId}\0${cwd}\0${query}` : null),
    [cwd, query, searchable, serverId, workspaceId],
  );

  useEffect(() => {
    if (!requestKey || !client || !cwd) {
      setState(EMPTY_STATE);
      return;
    }
    let cancelled = false;
    // The previous matches stay on screen until the next ones arrive.
    setState((previous) => ({ ...previous, requestKey, loading: true, error: null }));
    const activeClient = client;
    const activeCwd = cwd;
    async function search(): Promise<void> {
      try {
        const payload = await activeClient.searchWorkspaceContent({ cwd: activeCwd, query });
        if (cancelled) return;
        setState({
          requestKey,
          matches: payload.matches,
          truncated: payload.truncated,
          loading: false,
          error: payload.error,
        });
      } catch (error) {
        if (!cancelled) setState({ ...EMPTY_STATE, requestKey, error: errorMessage(error) });
      }
    }
    const timer = setTimeout(() => void search(), SEARCH_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [client, cwd, query, requestKey]);

  const openMatch = useCallback(
    (match: WorkspaceContentMatch) => {
      if (!serverId || !workspaceId) return;
      openFileFromCommandCenter({
        serverId,
        workspaceId,
        path: match.path,
        lineStart: match.line,
      });
    },
    [serverId, workspaceId],
  );

  const current = requestKey !== null;
  if (input.enabled && serverId && !supported) {
    return {
      matches: [],
      truncated: false,
      loading: false,
      error: t("shell.commandCenter.contentSearch.unsupported"),
      openMatch,
    };
  }
  return {
    matches: current ? state.matches : [],
    truncated: current && state.truncated,
    loading: current && (state.requestKey !== requestKey || state.loading),
    error: state.requestKey === requestKey ? state.error : null,
    openMatch,
  };
}
