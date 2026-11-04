import { useTaskNavigationStore } from "./store";
import { activeDesk, activeDeskTab, deskContextTab, useDesksStore } from "./desks-store";
import { resolveMainContentPaneId } from "@/git/diff-tabs/model";
import { useSessionStore } from "@/stores/session-store";
import type { WorkspaceTabPlacement } from "@/stores/workspace-layout-store";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

/** Bridge existing workspace launchers into the current Desk without changing their source. */
export function openDeskTarget(input: {
  workspaceKey: string | null;
  target: WorkspaceTabTarget;
  pin?: boolean;
  placement?: WorkspaceTabPlacement;
}): string | null {
  if (!useTaskNavigationStore.getState().enabled || !input.workspaceKey) return null;
  for (const [serverId, session] of Object.entries(useSessionStore.getState().sessions)) {
    for (const workspace of session.workspaces.values()) {
      if (`${serverId}:${workspace.id}` !== input.workspaceKey) continue;
      useDesksStore
        .getState()
        .openTab(
          { serverId, workspaceId: workspace.id, target: input.target },
          input.pin ?? true,
          input.placement,
        );
      return activeDeskTab(useDesksStore.getState())?.id ?? null;
    }
  }
  return null;
}

/** CUSTOM(desk-file-search): opens where the Explorer opens files, never in the bottom panel. */
export function openDeskTargetInMainContent(input: {
  workspaceKey: string | null;
  target: WorkspaceTabTarget;
}): string | null {
  const state = useDesksStore.getState();
  const paneId = resolveMainContentPaneId(
    activeDesk(state).layout,
    deskContextTab(state)?.id ?? null,
  );
  return openDeskTarget({
    ...input,
    placement: paneId ? { mode: "prefer", paneId } : undefined,
  });
}
