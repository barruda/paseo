// CUSTOM(bottom-panel-warp-project-tab): showing a hidden bottom panel whose selected tab is Warp
// switches Warp to the tab of the agent's project, opening one when there is none. The project is
// the same one the Warp chip's + uses: in Tasks mode the last focused agent tab's workspace, in a
// workspace the workspace itself.
import { useBrowserStore } from "@/desktop/browser/store";
import { useSessionStore } from "@/stores/session-store";
import type { WorkspaceLayout } from "@/stores/workspace-layout-actions";
import { bottomPanelWarpBrowserId } from "./bottom-panel-default";
import { showWarpSessionIn } from "./warp-session";

export function showBottomPanelWarpProject(input: {
  layout: WorkspaceLayout;
  serverId: string;
  workspaceId: string;
}): void {
  const browsers = useBrowserStore.getState().browsersById;
  const browserId = bottomPanelWarpBrowserId(
    input.layout,
    (id) => browsers[id]?.hideToolbar === true,
  );
  const directory = useSessionStore
    .getState()
    .sessions[input.serverId]?.workspaces.get(input.workspaceId)?.workspaceDirectory;
  if (browserId && directory) void showWarpSessionIn(browserId, directory);
}
