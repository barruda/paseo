// CUSTOM(bottom-panel-warp): a new bottom panel opens Warp instead of a terminal. The launcher tab
// becomes the Warp plugin panel, which turns itself into the Warp browser tab. Warp tabs are
// browser tabs, so this needs Electron and the Warp plugin installed on the workspace's host;
// without either the panel keeps opening a terminal.
import type { PluginWorkspaceTabTarget } from "./model";

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
