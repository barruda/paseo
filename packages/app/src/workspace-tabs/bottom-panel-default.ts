// CUSTOM(bottom-panel-warp): a new bottom panel opens Warp instead of a terminal. The launcher tab
// becomes the Warp plugin panel, which turns itself into the Warp browser tab. Warp tabs are
// browser tabs, so this needs Electron and the Warp plugin installed on the workspace's host;
// without either the panel keeps opening a terminal.
import {
  collectAllTabs,
  findPaneById,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-actions";
import { BOTTOM_PANEL_PANE_ID } from "./bottom-panel";
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

/**
 * CUSTOM(bottom-panel-warp-project-tab): the Warp page the bottom panel shows, when its selected
 * tab is a Warp tab (a browser tab without a toolbar).
 */
export function bottomPanelWarpBrowserId(
  layout: WorkspaceLayout,
  isWarpBrowser: (browserId: string) => boolean,
): string | null {
  const tabId = findPaneById(layout.root, BOTTOM_PANEL_PANE_ID)?.focusedTabId;
  const target = collectAllTabs(layout.root).find((tab) => tab.tabId === tabId)?.target;
  return target?.kind === "browser" && isWarpBrowser(target.browserId) ? target.browserId : null;
}
