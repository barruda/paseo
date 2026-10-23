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
// showing it again opens a Warp session (a tab inside Warp) in the focused task's workspace. The
// panel's Warp tab remembers the folder of the last session Paseo opened there, so hiding and
// showing the panel for the same task doesn't open another.
export type DeskBottomPanelShowAction =
  | { kind: "keep" }
  | { kind: "select"; tabId: string }
  | { kind: "new-session"; tabId: string; browserId: string }
  | { kind: "open" };

export function resolveDeskBottomPanelShow(input: {
  /** The bottom panel's tabs, in order. */
  tabs: readonly { id: string; target: WorkspaceTabTarget }[];
  focusedTabId: string | null;
  directory: string;
  isWarpBrowser: (browserId: string) => boolean;
  /** The folder of the last Warp session Paseo opened in that browser tab. */
  sessionDirectory: (browserId: string) => string | null;
}): DeskBottomPanelShowAction {
  const warpTabs = input.tabs.filter(
    (tab) =>
      (tab.target.kind === "plugin" && tab.target.pluginId === WARP_PLUGIN_ID) ||
      (tab.target.kind === "browser" && input.isWarpBrowser(tab.target.browserId)),
  );
  const tab = warpTabs.find((entry) => entry.id === input.focusedTabId) ?? warpTabs[0];
  if (!tab) return { kind: "open" };
  const focused = tab.id === input.focusedTabId;
  // A Warp panel still turning into its browser tab starts in its own workspace.
  if (tab.target.kind !== "browser")
    return focused ? { kind: "keep" } : { kind: "select", tabId: tab.id };
  const { browserId } = tab.target;
  if (input.sessionDirectory(browserId) !== input.directory) {
    return { kind: "new-session", tabId: tab.id, browserId };
  }
  return focused ? { kind: "keep" } : { kind: "select", tabId: tab.id };
}
