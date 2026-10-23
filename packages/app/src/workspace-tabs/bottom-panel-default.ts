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

// CUSTOM(bottom-panel-warp-tab-button): the bottom panel's Warp tab that the "new Warp tab in this
// project" button opens a session in: the selected tab when it's Warp, else the first Warp tab.
export function pickBottomPanelWarpTab(
  tabs: readonly { tabId: string; target: WorkspaceTabTarget; isActive: boolean }[],
  isWarpBrowser: (browserId: string) => boolean,
): { tabId: string; browserId: string } | null {
  const warpTabs = tabs.flatMap((tab) =>
    tab.target.kind === "browser" && isWarpBrowser(tab.target.browserId)
      ? [{ tabId: tab.tabId, browserId: tab.target.browserId, isActive: tab.isActive }]
      : [],
  );
  const tab = warpTabs.find((entry) => entry.isActive) ?? warpTabs[0];
  return tab ? { tabId: tab.tabId, browserId: tab.browserId } : null;
}
