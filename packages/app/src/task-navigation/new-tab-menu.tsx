// CUSTOM(desks): the standard new-tab catalog, launched into the Desk with the scope workspace.
import { useCallback, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useWorkspaceDirectory, useWorkspaceFields } from "@/stores/session-store-hooks";
import { generateDraftId } from "@/stores/draft-keys";
import { createWorkspaceBrowser } from "@/desktop/browser/store";
import { getIsElectron } from "@/constants/platform";
import {
  useWorkspaceTerminals,
  type TerminalTabDestination,
} from "@/screens/workspace/terminals/use-workspace-terminals";
import { useWorkspaceCheckoutStatus } from "@/screens/workspace/use-workspace-checkout-status";
import { useHasPullRequest } from "@/panels/pull-request";
import { NewTabLauncherProvider, type NewTabLauncher } from "@/workspace-tabs/launcher";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { useKeyboardActionHandler } from "@/hooks/use-keyboard-action-handler";
import { activeDesk, useDesksStore, type DeskTabOwner } from "./desks-store";

/** Opens a launched target in its pane, or turns the launching new-tab tab into it. */
export function launchDeskTarget(
  scope: DeskTabOwner,
  target: WorkspaceTabTarget,
  destination: TerminalTabDestination,
) {
  const store = useDesksStore.getState();
  if (destination.kind === "replace") {
    store.updateTab(destination.tabId, { ...scope, target });
    store.selectTab(destination.tabId);
    return;
  }
  store.openTab(
    { ...scope, target },
    true,
    destination.paneId ? { mode: "pane", paneId: destination.paneId } : undefined,
  );
}

export function DeskLauncherProvider({
  scope,
  enabled,
  children,
}: {
  scope: DeskTabOwner;
  /** Whether this Desk owns the workspace launch shortcuts (new tab, terminal, agent, browser). */
  enabled: boolean;
  children: ReactNode;
}) {
  const { serverId, workspaceId } = scope;
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const directory = useWorkspaceDirectory(serverId, workspaceId);
  const workspace = useWorkspaceFields(serverId, workspaceId, (w) => ({ scripts: w.scripts }));
  const toast = useToast();
  const { t } = useTranslation();
  const open = useCallback(
    (target: WorkspaceTabTarget, destination: TerminalTabDestination) =>
      launchDeskTarget({ serverId, workspaceId }, target, destination),
    [serverId, workspaceId],
  );
  const terminalCreated = useCallback(
    (input: { terminalId: string; destination: TerminalTabDestination }) =>
      open({ kind: "terminal", terminalId: input.terminalId }, input.destination),
    [open],
  );
  const terminalSelected = useCallback(
    (terminalId: string) => open({ kind: "terminal", terminalId }, { kind: "open" }),
    [open],
  );
  const unavailable = useCallback(
    () => toast.error(t("workspace.header.toasts.workspacePathUnavailable")),
    [toast, t],
  );
  const queued = useCallback(
    () => toast.show(t("workspace.header.toasts.terminalQueued")),
    [toast, t],
  );
  const failed = useCallback((reason: string) => toast.error(reason), [toast]);
  const terminals = useWorkspaceTerminals({
    client,
    isConnected,
    isRouteFocused: true,
    normalizedServerId: serverId,
    normalizedWorkspaceId: workspaceId,
    workspaceDirectory: directory,
    workspaceScripts: workspace?.scripts ?? [],
    hasHydratedWorkspaces: Boolean(workspace),
    isMissingWorkspaceDirectory: !directory,
    onTerminalCreated: terminalCreated,
    onScriptTerminalSelected: terminalSelected,
    onWorkspacePathUnavailable: unavailable,
    onTerminalCreateQueued: queued,
    onTerminalCreateFailed: failed,
  });
  const { checkoutQuery } = useWorkspaceCheckoutStatus({
    client,
    isConnected,
    isRouteFocused: true,
    normalizedServerId: serverId,
    normalizedWorkspaceId: workspaceId,
    workspaceDirectory: directory,
  });
  const isGit = checkoutQuery.data?.isGit ?? false;
  const hasPullRequest = useHasPullRequest({ serverId, cwd: directory, enabled: isGit });
  const createTerminal = terminals.createTerminal;
  const launch = useCallback<NewTabLauncher["launch"]>(
    (selection, destination) => {
      if (selection.kind === "target") open(selection.target, destination);
      else if (selection.kind === "agent")
        open({ kind: "draft", draftId: generateDraftId() }, destination);
      else if (selection.kind === "terminal")
        createTerminal({ profile: selection.profile, destination });
      else open({ kind: "browser", browserId: createWorkspaceBrowser().browserId }, destination);
    },
    [open, createTerminal],
  );
  const terminalDisabled =
    !isConnected ||
    !directory ||
    terminals.createMutation.isPending ||
    terminals.pendingCreateInput !== null;
  // CUSTOM(desk-launch-shortcuts): the workspace screen that normally handles these is not
  // mounted in Tasks mode, so launches land in the Desk's focused pane instead.
  useKeyboardActionHandler({
    handlerId: `desk-launch:${serverId}:${workspaceId}`,
    enabled,
    priority: 150,
    actions: [
      "workspace.terminal.new",
      "workspace.agent.new",
      "workspace.browser.new",
      "workspace.tab.target.agent",
      "workspace.tab.target.browser",
      "workspace.tab.menu.open",
    ],
    handle: (action) => {
      const paneId = activeDesk(useDesksStore.getState()).layout.focusedPaneId ?? undefined;
      const destination: TerminalTabDestination = { kind: "open", paneId };
      if (action.id === "workspace.terminal.new") {
        if (!terminalDisabled) createTerminal({ destination });
        return true;
      }
      if (action.id === "workspace.agent.new" || action.id === "workspace.tab.target.agent") {
        launch({ kind: "agent" }, destination);
        return true;
      }
      if (action.id === "workspace.browser.new" || action.id === "workspace.tab.target.browser") {
        if (getIsElectron()) launch({ kind: "browser" }, destination);
        return true;
      }
      if (action.id === "workspace.tab.menu.open") {
        useDesksStore.getState().createNewTab({ serverId, workspaceId }, paneId);
        return true;
      }
      return false;
    },
  });
  const launcher = useMemo<NewTabLauncher>(
    () => ({
      showChanges: isGit,
      showPullRequest: hasPullRequest,
      showBrowser: getIsElectron(),
      terminalDisabled,
      launch,
    }),
    [isGit, hasPullRequest, terminalDisabled, launch],
  );
  return <NewTabLauncherProvider value={launcher}>{children}</NewTabLauncherProvider>;
}
