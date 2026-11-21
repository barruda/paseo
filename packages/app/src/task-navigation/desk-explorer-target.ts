// CUSTOM(desk-explorer): which workspace's Explorer a Desk shows and whose open state it uses, for
// code outside React (the Project Manager button). DeskScreen's useDeskExplorerTarget follows the
// same rule: the context tab's workspace, else the focused tab's, else the route's workspace.
import {
  findPaneById,
  selectExplorerSidebarPaneId,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { activeDesk, activeDeskTab, deskContextTab, type DeskTabOwner } from "./desks-store";

type DesksSnapshot = Parameters<typeof deskContextTab>[0];

export interface DeskExplorerTarget {
  scope: DeskTabOwner | null;
  /** The Desk tab that owns the Explorer's open state (null on an empty Desk). */
  tabId: string | null;
}

export function deskExplorerTarget(
  state: DesksSnapshot,
  selection: DeskTabOwner | null,
): DeskExplorerTarget {
  const contextTab = deskContextTab(state);
  const active = activeDeskTab(state);
  const serverId = contextTab?.serverId ?? active?.serverId ?? selection?.serverId;
  const workspaceId = contextTab?.workspaceId ?? active?.workspaceId ?? selection?.workspaceId;
  const desk = activeDesk(state);
  const focusedTabId = findPaneById(desk.layout.root, desk.layout.focusedPaneId)?.focusedTabId;
  return {
    scope: serverId && workspaceId ? { serverId, workspaceId } : null,
    tabId: contextTab?.id ?? focusedTabId ?? null,
  };
}

/**
 * The dock renders the workspace's Explorer pane, so a workspace without one gets a hidden one.
 * Returns the pane id.
 */
export function ensureExplorerPane(workspaceKey: string): string | null {
  const store = useWorkspaceLayoutStore.getState();
  const layout = store.layoutByWorkspace[workspaceKey];
  const existing = selectExplorerSidebarPaneId(store, workspaceKey);
  if (layout && findPaneById(layout.root, existing)) return existing;
  const paneId = store.showExplorerSidebar(workspaceKey);
  store.hideExplorerSidebar(workspaceKey);
  return paneId;
}
