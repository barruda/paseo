import { buildPluginSettingsRoute } from "./settings/routes";
import { router } from "expo-router";
import type { PluginPanelLocation } from "@getpaseo/plugin/client";
import { navigateToWorkspace } from "@/stores/navigation-active-workspace-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildPluginSurfaceRoute } from "./routes";
import type { PluginNavigation } from "./actions";
import {
  openWorkboardInDesk,
  openWorkboardPanelInDesk,
} from "@/task-navigation/desk-workboard-store";

export function createPluginNavigation(input: {
  serverId: string;
  workspaceId: string | null;
}): PluginNavigation {
  const { serverId, workspaceId } = input;
  function placement(location: PluginPanelLocation) {
    if (location !== "explorer") return undefined;
    if (!workspaceId) throw new Error("No active workspace");
    const workspaceKey = `${serverId}:${workspaceId}`;
    const paneId = useWorkspaceLayoutStore.getState().showExplorerSidebar(workspaceKey);
    if (!paneId) throw new Error("Explorer is unavailable");
    return { mode: "pane" as const, paneId };
  }
  return {
    openSettings(pluginId, screenId) {
      router.push(buildPluginSettingsRoute(serverId, pluginId, screenId));
    },
    openSurface(pluginId, surfaceId, params) {
      // CUSTOM(workboard-chip-only): in Tasks mode Power Workboard opens on its Desk chip.
      if (openWorkboardInDesk({ pluginId, screenId: surfaceId, params })) return;
      router.push(
        buildPluginSurfaceRoute(serverId, pluginId, { kind: "surface", id: surfaceId }, params),
      );
    },
    openWorkspacePanel(pluginId, panelId, location) {
      // CUSTOM(workboard-chip-only): never a Power Workboard tab in a Desk; its chip instead.
      if (openWorkboardPanelInDesk(pluginId, panelId)) return;
      if (!workspaceId) throw new Error("No active workspace");
      navigateToWorkspace({
        serverId,
        workspaceId,
        target: { kind: "plugin", pluginId, panelId, context: "workspace" },
        placement: placement(location),
      });
    },
    openAgentPanel(pluginId, panelId, agentId, location) {
      if (!workspaceId) throw new Error("No active workspace");
      navigateToWorkspace({
        serverId,
        workspaceId,
        target: { kind: "plugin", pluginId, panelId, context: "agent", agentId },
        placement: placement(location),
      });
    },
  };
}
