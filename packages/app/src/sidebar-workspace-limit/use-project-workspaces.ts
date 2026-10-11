import { useCallback, useMemo } from "react";
import type { SidebarWorkspacePlacement } from "@/hooks/use-sidebar-workspaces-list";
import { useSidebarWorkspaceLimitResult } from "./context";
import { useSidebarWorkspaceLimitStore } from "./store";

/** A project's rows under the limit, and its Show more/less state when the limit trims it. */
export function useLimitedProjectWorkspaces(input: {
  viewKey: string;
  workspaces: SidebarWorkspacePlacement[];
}) {
  const { viewKey, workspaces } = input;
  const { hiddenWorkspaceKeys, limitedProjectKeys } = useSidebarWorkspaceLimitResult();
  const expanded = useSidebarWorkspaceLimitStore((state) => state.expandedProjectKeys.has(viewKey));
  const toggleProjectExpanded = useSidebarWorkspaceLimitStore(
    (state) => state.toggleProjectExpanded,
  );
  const toggleExpanded = useCallback(
    () => toggleProjectExpanded(viewKey),
    [toggleProjectExpanded, viewKey],
  );
  const shown = useMemo(
    () =>
      hiddenWorkspaceKeys.size > 0
        ? workspaces.filter((workspace) => !hiddenWorkspaceKeys.has(workspace.workspaceKey))
        : workspaces,
    [hiddenWorkspaceKeys, workspaces],
  );
  return {
    workspaces: shown,
    hiddenCount: workspaces.length - shown.length,
    limited: limitedProjectKeys.has(viewKey),
    expanded,
    toggleExpanded,
  };
}
