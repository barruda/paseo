// CUSTOM(desks): use the standard catalog with the selected tab's source workspace.
import { Folder } from "lucide-react-native";
import { DropdownMenuItem, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { DensityIcon } from "@/components/ui/density-icon";
import { useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useToast } from "@/contexts/toast-context";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useWorkspaceDirectory, useWorkspaceFields } from "@/stores/session-store-hooks";
import { generateDraftId } from "@/stores/draft-keys";
import { createWorkspaceBrowser } from "@/desktop/browser/store";
import { getIsElectron } from "@/constants/platform";
import { WorkspaceNewTabMenuContent } from "@/screens/workspace/workspace-new-tab-menu";
import { useWorkspaceTerminals } from "@/screens/workspace/terminals/use-workspace-terminals";
import { useWorkspaceCheckoutStatus } from "@/screens/workspace/use-workspace-checkout-status";
import { useHasPullRequest } from "@/panels/pull-request";
import { NewTabLauncherProvider, type NewTabLauncher } from "@/workspace-tabs/launcher";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { useDesksStore, type DeskTabInput } from "./desks-store";

const EMPTY_KINDS: readonly WorkspaceTabTarget["kind"][] = [];
export function DeskNewTabMenu({ scope }: { scope: DeskTabInput }) {
  const { serverId, workspaceId } = scope;
  const client = useHostRuntimeClient(serverId);
  const isConnected = useHostRuntimeIsConnected(serverId);
  const directory = useWorkspaceDirectory(serverId, workspaceId);
  const workspace = useWorkspaceFields(serverId, workspaceId, (w) => ({ scripts: w.scripts }));
  const toast = useToast();
  const { t } = useTranslation();
  const open = useCallback(
    (target: WorkspaceTabTarget) => {
      useDesksStore.getState().openTab({ serverId, workspaceId, target }, true);
    },
    [serverId, workspaceId],
  );
  const openFiles = useCallback(() => open({ kind: "files" }), [open]);
  const filesIcon = useMemo(
    () => <DensityIcon icon={Folder} size="sm" color="foregroundMuted" />,
    [],
  );
  const terminalCreated = useCallback(
    ({ terminalId }: { terminalId: string }) => open({ kind: "terminal", terminalId }),
    [open],
  );
  const terminalSelected = useCallback(
    (terminalId: string) => open({ kind: "terminal", terminalId }),
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
    (selection) => {
      if (selection.kind === "target") open(selection.target);
      else if (selection.kind === "agent") open({ kind: "draft", draftId: generateDraftId() });
      else if (selection.kind === "terminal")
        createTerminal({ profile: selection.profile, destination: { kind: "open" } });
      else open({ kind: "browser", browserId: createWorkspaceBrowser().browserId });
    },
    [open, createTerminal],
  );
  const terminalDisabled =
    !isConnected ||
    !directory ||
    terminals.createMutation.isPending ||
    terminals.pendingCreateInput !== null;
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
  return (
    <NewTabLauncherProvider value={launcher}>
      <WorkspaceNewTabMenuContent
        serverId={serverId}
        purpose="primary"
        host="main"
        panePanelKinds={EMPTY_KINDS}
      >
        <DropdownMenuSeparator />
        <DropdownMenuItem
          leading={filesIcon}
          onSelect={openFiles}
          testID="workspace-new-tab-menu-files"
        >
          {t("panels.files.label")}
        </DropdownMenuItem>
      </WorkspaceNewTabMenuContent>
    </NewTabLauncherProvider>
  );
}
