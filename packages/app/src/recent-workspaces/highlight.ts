import { create } from "zustand";
import type { ActiveWorkspaceSelection } from "@/stores/last-workspace-selection";

interface RecentHighlightState {
  target: ActiveWorkspaceSelection | null;
  visibleWorkspaces: readonly ActiveWorkspaceSelection[];
}

// Transient presentation state; workspace navigation and archive ownership remain unchanged.
export const useRecentHighlightStore = create<RecentHighlightState>(() => ({
  target: null,
  visibleWorkspaces: [],
}));

export function shouldHighlightWorkspaceRow({
  selected,
  isRecentRow,
  workspace,
  target,
  visibleWorkspaces,
}: RecentHighlightState & {
  selected: boolean;
  isRecentRow: boolean;
  workspace: ActiveWorkspaceSelection;
}): boolean {
  if (!selected || isRecentRow) return selected;
  const isCycleTarget =
    target?.serverId === workspace.serverId && target?.workspaceId === workspace.workspaceId;
  const targetIsVisible = visibleWorkspaces.some(
    (item) => item.serverId === workspace.serverId && item.workspaceId === workspace.workspaceId,
  );
  return !(isCycleTarget && targetIsVisible);
}

export function useWorkspaceRowHighlight(
  selected: boolean,
  isRecentRow: boolean,
  workspace: ActiveWorkspaceSelection,
): boolean {
  return useRecentHighlightStore((state) =>
    shouldHighlightWorkspaceRow({ ...state, selected, isRecentRow, workspace }),
  );
}
