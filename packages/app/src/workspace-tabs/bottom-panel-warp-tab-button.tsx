// CUSTOM(bottom-panel-warp-tab-button): a button beside the bottom panel's tabs that opens a new
// tab inside its Warp tab, in the folder of the agent's project: in Tasks mode the last focused
// agent tab's workspace, in a workspace the workspace itself.
import { SquareTerminal } from "lucide-react-native";
import { useCallback } from "react";
import { withUnistyles } from "react-native-unistyles";
import { mutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { useBrowserStore } from "@/desktop/browser/store";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { useSessionStore } from "@/stores/session-store";
import { deskContextTab, useDesksStore } from "@/task-navigation/desks-store";
import { useTaskNavigationStore } from "@/task-navigation/store";
import { pickBottomPanelWarpTab } from "./bottom-panel-default";
import { openWarpSession } from "./warp-session";

const ThemedSquareTerminal = withUnistyles(SquareTerminal);

interface PaneTab {
  tab: { tabId: string; target: WorkspaceTabTarget };
  isActive: boolean;
}

export function BottomPanelWarpTabButton({
  tabs,
  serverId,
  workspaceId,
  onNavigateTab,
}: {
  tabs: readonly PaneTab[];
  serverId: string;
  workspaceId: string;
  onNavigateTab: (tabId: string) => void;
}) {
  // A string, so the selector result stays stable between store updates.
  const warpKey = useBrowserStore((state) => {
    const warp = pickBottomPanelWarpTab(
      tabs.map(({ tab, isActive }) => ({ tabId: tab.tabId, target: tab.target, isActive })),
      (browserId) => state.browsersById[browserId]?.hideToolbar === true,
    );
    return warp ? `${warp.tabId}\n${warp.browserId}` : null;
  });
  const tasksMode = useTaskNavigationStore((state) => state.enabled);
  const contextTab = useDesksStore((state) => (tasksMode ? deskContextTab(state) : null));
  const owner = contextTab ?? { serverId, workspaceId };
  const directory = useSessionStore(
    (state) =>
      state.sessions[owner.serverId]?.workspaces.get(owner.workspaceId)?.workspaceDirectory ?? null,
  );

  const handlePress = useCallback(() => {
    if (!warpKey || !directory) return;
    const [tabId, browserId] = warpKey.split("\n") as [string, string];
    onNavigateTab(tabId);
    void openWarpSession(browserId, directory);
  }, [directory, onNavigateTab, warpKey]);

  if (!warpKey || !directory) return null;
  return (
    <ToolbarButton
      label="New Warp tab in the agent's project"
      tooltip={`New Warp tab in ${directory}`}
      tooltipSide="top"
      testID="bottom-panel-warp-tab"
      onPress={handlePress}
    >
      <ThemedSquareTerminal size={15} uniProps={mutedIconColorMapping} />
    </ToolbarButton>
  );
}
