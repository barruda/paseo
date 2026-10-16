import { useTaskNavigationStore } from "./store";
import { activeDeskTab, useDesksStore } from "./desks-store";
import { useSessionStore } from "@/stores/session-store";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

/** Bridge existing workspace launchers into the current Desk without changing their source. */
export function openDeskTarget(input: {
  workspaceKey: string | null;
  target: WorkspaceTabTarget;
  pin?: boolean;
}): string | null {
  if (!useTaskNavigationStore.getState().enabled || !input.workspaceKey) return null;
  for (const [serverId, session] of Object.entries(useSessionStore.getState().sessions)) {
    for (const workspace of session.workspaces.values()) {
      if (`${serverId}:${workspace.id}` !== input.workspaceKey) continue;
      useDesksStore
        .getState()
        .openTab({ serverId, workspaceId: workspace.id, target: input.target }, input.pin ?? true);
      return activeDeskTab(useDesksStore.getState())?.id ?? null;
    }
  }
  return null;
}
