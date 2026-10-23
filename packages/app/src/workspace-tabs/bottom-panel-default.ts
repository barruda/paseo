// CUSTOM(bottom-panel-warp): a new bottom panel opens Warp instead of a terminal. The launcher tab
// becomes the Warp plugin panel, which turns itself into the Warp browser tab. Warp tabs are
// browser tabs, so this needs Electron and the Warp plugin installed on the workspace's host;
// without either the panel keeps opening a terminal.
import type { PluginWorkspaceTabTarget, WorkspaceTabTarget } from "./model";

const WARP_PLUGIN_ID = "warp";
const WARP_PANEL_ID = "warp";

interface PluginPanels {
  id: string;
  serverId: string;
  workspacePanels: readonly { id: string; context: string }[];
}

export function resolveBottomPanelWarpTarget(input: {
  serverId: string;
  plugins: readonly PluginPanels[];
  isElectron: boolean;
}): PluginWorkspaceTabTarget | null {
  if (!input.isElectron) return null;
  const warp = input.plugins.find(
    (plugin) => plugin.id === WARP_PLUGIN_ID && plugin.serverId === input.serverId,
  );
  const hasPanel = warp?.workspacePanels.some(
    (panel) => panel.id === WARP_PANEL_ID && panel.context === "workspace",
  );
  return hasPanel
    ? { kind: "plugin", pluginId: WARP_PLUGIN_ID, panelId: WARP_PANEL_ID, context: "workspace" }
    : null;
}

// CUSTOM(desk-bottom-panel-warp): in Tasks mode the bottom panel is shared by every task, so
// showing it again opens a Warp tab in the focused task's workspace. A Warp tab that workspace
// already has is selected instead, so hiding and showing the panel doesn't pile up tabs.
export type DeskBottomPanelShowAction =
  | { kind: "keep" }
  | { kind: "select"; tabId: string }
  | { kind: "open" };

export function resolveDeskBottomPanelShow(input: {
  /** The bottom panel's tabs, in order. */
  tabs: readonly { id: string; workspaceId: string; target: WorkspaceTabTarget }[];
  focusedTabId: string | null;
  workspaceId: string;
  isWarpBrowser: (browserId: string) => boolean;
}): DeskBottomPanelShowAction {
  const own = input.tabs.filter((tab) => tab.workspaceId === input.workspaceId);
  const isWarp = (target: WorkspaceTabTarget) =>
    (target.kind === "plugin" && target.pluginId === WARP_PLUGIN_ID) ||
    (target.kind === "browser" && input.isWarpBrowser(target.browserId));
  const focused = own.find((tab) => tab.id === input.focusedTabId);
  if (focused && isWarp(focused.target)) return { kind: "keep" };
  const warp = own.find((tab) => isWarp(tab.target));
  return warp ? { kind: "select", tabId: warp.id } : { kind: "open" };
}
