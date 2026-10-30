import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  type MutableRefObject,
  type ReactNode,
} from "react";
import React from "react";
import type { ToastApi } from "@/components/toast-host";
import type { OpenFileDisposition } from "@/workspace/file-open";
import type { InlinePathTarget } from "./parse";
import type { AssistantFileLinkContext, GetDirectorySuggestions } from "./resolver";

export interface AssistantFileLinkDaemonClient {
  readFile?: import("@getpaseo/client/internal/daemon-client").DaemonClient["readFile"];
  getDirectorySuggestions: GetDirectorySuggestions;
}

export interface AssistantFileLinkResolverConfig {
  client?: AssistantFileLinkDaemonClient | null;
  serverId?: string;
  workspaceRoot?: string;
  relativePathBase?: string;
  /** CUSTOM(session-file-paths): full paths the agent's tool calls touched, newest first. */
  sessionPaths?: readonly string[];
  onOpenWorkspaceFile?: (target: InlinePathTarget, disposition: OpenFileDisposition) => void;
  toast?: ToastApi | null;
}

export interface AssistantFileLinkResolverProviderProps extends AssistantFileLinkResolverConfig {
  children: ReactNode;
}

export interface AssistantFileLinkResolverContextValue {
  configRef: MutableRefObject<AssistantFileLinkResolverConfig>;
  getDirectorySuggestions: GetDirectorySuggestions;
  /** CUSTOM(session-file-paths): in the value too, so links re-resolve when it changes. */
  sessionPaths?: readonly string[];
}

const AssistantFileLinkResolverContext =
  createContext<AssistantFileLinkResolverContextValue | null>(null);

export function useAssistantFileLinkEnvironmentBridge() {
  const value = useContext(AssistantFileLinkResolverContext);
  return useCallback(
    (children: ReactNode) => (
      <AssistantFileLinkResolverContext.Provider value={value}>
        {children}
      </AssistantFileLinkResolverContext.Provider>
    ),
    [value],
  );
}

export function AssistantFileLinkResolverProvider({
  client,
  serverId,
  workspaceRoot,
  relativePathBase,
  sessionPaths,
  onOpenWorkspaceFile,
  toast,
  children,
}: AssistantFileLinkResolverProviderProps) {
  const configRef = useRef<AssistantFileLinkResolverConfig>({
    client,
    serverId,
    workspaceRoot,
    relativePathBase,
    sessionPaths,
    onOpenWorkspaceFile,
    toast,
  });
  configRef.current = {
    client,
    serverId,
    workspaceRoot,
    relativePathBase,
    sessionPaths,
    onOpenWorkspaceFile,
    toast,
  };

  const getDirectorySuggestions = useCallback<GetDirectorySuggestions>(async (input) => {
    const activeClient = configRef.current.client;
    if (!activeClient) {
      return { entries: [], error: null };
    }

    const result = await activeClient.getDirectorySuggestions(input);
    return { entries: result.entries, error: result.error };
  }, []);

  const value = useMemo<AssistantFileLinkResolverContextValue>(
    () => ({ configRef, getDirectorySuggestions, sessionPaths }),
    [getDirectorySuggestions, sessionPaths],
  );

  return (
    <AssistantFileLinkResolverContext.Provider value={value}>
      {children}
    </AssistantFileLinkResolverContext.Provider>
  );
}

export function useAssistantFileLinkResolverContext(): AssistantFileLinkResolverContextValue {
  const context = useContext(AssistantFileLinkResolverContext);
  return context ?? EMPTY_CONTEXT;
}

/**
 * CUSTOM(shell-output-files): whether file links can resolve here. Tool call details also render
 * outside the chat stream's provider (the native tool call sheet), where a link would throw.
 */
export function useHasAssistantFileLinkResolver(): boolean {
  return useContext(AssistantFileLinkResolverContext) !== null;
}

export type { AssistantFileLinkContext };

const EMPTY_CONTEXT: AssistantFileLinkResolverContextValue = {
  configRef: { current: {} },
  getDirectorySuggestions: async () => ({ entries: [], error: null }),
};

export function useAssistantFileLinkEnvironment() {
  return useAssistantFileLinkResolverContext().configRef.current;
}
