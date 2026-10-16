// CUSTOM(new-workspace-terminal): the New Workspace screen's Ctrl/Cmd+J terminal panel.
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useIsFocused } from "@react-navigation/native";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TerminalPane } from "@/components/terminal-pane";
import { supportsDesktopPaneSplits, useIsCompactFormFactor } from "@/constants/layout";
import { useReplicaQuery } from "@/data/query";
import { workspaceTerminalsPushRoute } from "@/data/push-router";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import type { KeyboardActionId } from "@/keyboard/keyboard-action-dispatcher";
import { useKeyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher-context";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import {
  buildTerminalsQueryKey,
  type ListTerminalsPayload,
  upsertCreatedTerminalPayload,
} from "@/screens/workspace/terminals/state";
import { useSessionStore } from "@/stores/session-store";
import { toErrorMessage } from "@/utils/error-messages";
import {
  newWorkspaceTerminalScopeKey,
  pickTerminalWorkspace,
  resolveNewWorkspaceTerminalStep,
  useNewWorkspaceTerminalStore,
} from "./bottom-terminal";
import { useNewWorkspaceScreenPresence } from "./screen-presence";

const TOGGLE_ACTIONS: readonly KeyboardActionId[] = ["workspace.bottom-panel.toggle"];

function noop() {}

/** Hidden until Ctrl/Cmd+J; each visit to the screen starts with it hidden. */
export function NewWorkspaceBottomTerminal({
  serverId,
  cwd,
}: {
  serverId: string;
  cwd: string | null;
}) {
  const isScreenActive = useNewWorkspaceScreenPresence();
  return <WorkspaceBottomTerminal serverId={serverId} cwd={cwd} isActive={isScreenActive} />;
}

// CUSTOM(desk-bottom-panel): share terminal creation/reconnection with the New Workspace screen.
export function WorkspaceBottomTerminal({
  serverId,
  cwd,
  workspaceId,
  isActive,
  testID = "new-workspace-bottom-terminal",
}: {
  serverId: string;
  cwd: string | null;
  workspaceId?: string;
  isActive(): boolean;
  testID?: string;
}) {
  const handlerId = useId();
  const isCompact = useIsCompactFormFactor();
  const isRouteFocused = useIsFocused();
  const [visible, setVisible] = useState(false);
  const toggle = useCallback(() => {
    setVisible((current) => !current);
    return true;
  }, []);
  const hide = useCallback(() => setVisible(false), []);
  useKeyboardActionHandler({
    handlerId: `bottom-terminal:${handlerId}`,
    actions: TOGGLE_ACTIONS,
    enabled: Boolean(serverId && cwd) && !isCompact && supportsDesktopPaneSplits(),
    isActive,
    priority: 0,
    handle: toggle,
  });

  // Hiding unmounts the terminal, so hand the keyboard back to the composer.
  const dispatcher = useKeyboardActionDispatcher();
  const wasVisibleRef = useRef(false);
  useEffect(() => {
    if (isActive() && wasVisibleRef.current && !visible) {
      dispatcher.dispatch({ id: "message-input.focus", scope: "message-input" });
    }
    wasVisibleRef.current = visible;
  }, [dispatcher, visible, isActive]);

  if (!visible || !serverId || !cwd || isCompact) return null;
  return (
    <View style={styles.panel} testID={testID}>
      <BottomTerminalBody
        key={`${serverId}:${workspaceId ?? cwd}`}
        serverId={serverId}
        cwd={cwd}
        selectedWorkspaceId={workspaceId}
        isRouteFocused={isRouteFocused}
        onExited={hide}
      />
    </View>
  );
}

function BottomTerminalBody({
  serverId,
  cwd,
  isRouteFocused,
  onExited,
  selectedWorkspaceId,
}: {
  serverId: string;
  cwd: string;
  isRouteFocused: boolean;
  onExited(): void;
  selectedWorkspaceId?: string;
}) {
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const queryClient = useQueryClient();
  const scopeKey = newWorkspaceTerminalScopeKey(serverId, selectedWorkspaceId ?? cwd);
  const remembered = useNewWorkspaceTerminalStore((state) => state.terminals[scopeKey] ?? null);
  const remember = useNewWorkspaceTerminalStore((state) => state.remember);
  const forget = useNewWorkspaceTerminalStore((state) => state.forget);
  const workspaces = useSessionStore((state) => state.sessions[serverId]?.workspaces);
  const workspaceId = useMemo(
    () =>
      selectedWorkspaceId ??
      (workspaces ? (pickTerminalWorkspace(workspaces.values(), cwd)?.id ?? null) : null),
    [cwd, workspaces, selectedWorkspaceId],
  );

  // The push router only keeps terminals of the route's workspace, so the list is per workspace:
  // the remembered terminal's, else the one a new terminal goes to. Same key as the workspace
  // screen's terminal list.
  const listWorkspaceId = remembered?.workspaceId ?? workspaceId;
  const queryKey = useMemo(
    () => buildTerminalsQueryKey(serverId, cwd, listWorkspaceId),
    [cwd, listWorkspaceId, serverId],
  );
  const queryEnabled = Boolean(client && isConnected && listWorkspaceId);
  const terminalsQuery = useReplicaQuery({
    queryKey,
    enabled: queryEnabled,
    pushEvent: "terminals_changed",
    meta: workspaceTerminalsPushRoute({
      enabled: queryEnabled,
      serverId,
      cwd,
      ...(listWorkspaceId ? { workspaceId: listWorkspaceId } : {}),
    }),
    queryFn: async () => {
      if (!client || !listWorkspaceId) throw new Error("Host disconnected");
      return await client.listTerminals(cwd, undefined, { workspaceId: listWorkspaceId });
    },
  });
  const liveTerminalIds = useMemo(
    () => terminalsQuery.data?.terminals.map((terminal) => terminal.id) ?? null,
    [terminalsQuery.data],
  );

  const [error, setError] = useState<string | null>(null);
  const createMutation = useMutation({
    mutationFn: async (targetWorkspaceId: string) => {
      if (!client) throw new Error("Host disconnected");
      const payload = await client.createTerminal(cwd, undefined, undefined, {
        workspaceId: targetWorkspaceId,
      });
      if (!payload.terminal) throw new Error(payload.error ?? "Could not start a terminal");
      return { terminal: payload.terminal, workspaceId: targetWorkspaceId };
    },
    onSuccess: ({ terminal, workspaceId: terminalWorkspaceId }) => {
      queryClient.setQueryData<ListTerminalsPayload>(
        buildTerminalsQueryKey(serverId, cwd, terminalWorkspaceId),
        (current) => upsertCreatedTerminalPayload({ current, terminal, workspaceDirectory: cwd }),
      );
      remember(scopeKey, { terminalId: terminal.id, workspaceId: terminalWorkspaceId });
    },
    onError: (createError) => setError(toErrorMessage(createError)),
  });

  const [shownId, setShownId] = useState<string | null>(null);
  const step = resolveNewWorkspaceTerminalStep({
    workspaceId,
    liveTerminalIds,
    rememberedId: remembered?.terminalId ?? null,
    shownId,
    creating: createMutation.isPending || error !== null,
  });
  const createWorkspaceId = step.kind === "create" ? step.workspaceId : null;
  const attachId = step.kind === "attach" ? step.terminalId : null;
  // One create per showing, even when effects run twice.
  const { mutate } = createMutation;
  const createRequestedRef = useRef(false);
  useEffect(() => {
    if (!createWorkspaceId || createRequestedRef.current) return;
    createRequestedRef.current = true;
    mutate(createWorkspaceId);
  }, [createWorkspaceId, mutate]);
  useEffect(() => {
    if (attachId) setShownId(attachId);
  }, [attachId]);
  useEffect(() => {
    if (step.kind === "stale") forget(scopeKey);
    if (step.kind === "exited") {
      forget(scopeKey);
      onExited();
    }
  }, [forget, onExited, scopeKey, step.kind]);

  if (attachId) {
    return (
      <TerminalPane
        serverId={serverId}
        cwd={cwd}
        terminalId={attachId}
        isWorkspaceFocused={isRouteFocused}
        isPaneFocused
        onOpenFileExplorer={noop}
        onOpenWorkspaceFile={noop}
      />
    );
  }
  let message = "Starting terminal…";
  if (error) message = error;
  else if (step.kind === "no-workspace") {
    message = `No workspace in ${cwd}. The terminal runs inside one: open this folder as a workspace once.`;
  }
  return (
    <View style={styles.message}>
      <Text style={error ? styles.errorText : styles.messageText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  panel: {
    height: "40%",
    minHeight: 160,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
    backgroundColor: theme.colors.surface0,
  },
  message: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing[4],
  },
  messageText: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.base },
  errorText: { color: theme.colors.destructive, fontSize: theme.fontSize.base },
}));
