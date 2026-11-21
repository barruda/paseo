import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { usePanelStore } from "@/stores/panel-store";

/** Reveals the actual destination after placement and deduplication, including existing tabs. */
export function revealWorkspaceTab(workspaceKey: string, tabId: string | null): string | null {
  if (!tabId) return null;
  const store = useWorkspaceLayoutStore.getState();
  const destination = store.getTabDestination(workspaceKey, tabId);
  // Opening a sheet already reveals it, preserving the surface underneath.
  if (!destination) return null;
  if (destination.kind === "sheet") return tabId;
  store.focusTab(workspaceKey, tabId);
  const panels = usePanelStore.getState();
  if (store.layoutMode === "compact" && destination.host === "explorer") {
    panels.showMobileFileExplorer();
  } else {
    panels.showMobileAgent();
  }
  return tabId;
}

// CUSTOM(pending-open-keeps-sidebar): a pending open is consumed once the workspace hydrates, which
// can be after the user already opened the compact sidebar. Focus the tab, but leave that sidebar
// open instead of snapping the panel back to the workspace.
export function revealPendingWorkspaceTab(
  workspaceKey: string,
  tabId: string | null,
): string | null {
  if (usePanelStore.getState().mobilePanel.target !== "agent-list") {
    return revealWorkspaceTab(workspaceKey, tabId);
  }
  if (!tabId) return null;
  const store = useWorkspaceLayoutStore.getState();
  const destination = store.getTabDestination(workspaceKey, tabId);
  if (!destination) return null;
  if (destination.kind === "sheet") return tabId;
  store.focusTab(workspaceKey, tabId);
  return tabId;
}
