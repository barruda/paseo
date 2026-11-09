import { describe, expect, it } from "vitest";
import { launchDeskTarget } from "@/task-navigation/new-tab-menu";
import { useDesksStore } from "@/task-navigation/desks-store";
import { collectAllTabs, findPaneById } from "@/stores/workspace-layout-actions";
import {
  selectExplorerSidebarPaneId,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";

describe("launching Docs from the Desk's sidebar", () => {
  it("opens the Docs tab in the workspace's Explorer pane, not as a Desk tab", () => {
    const scope = { serverId: "srv", workspaceId: "ws" };
    const workspaceKey = "srv:ws";
    useWorkspaceLayoutStore.getState().ensureExplorerSidebar(workspaceKey);
    const desksBefore = useDesksStore.getState().desks;

    launchDeskTarget(scope, { kind: "docs" }, { kind: "open" });

    const state = useWorkspaceLayoutStore.getState();
    const layout = state.layoutByWorkspace[workspaceKey];
    const pane = findPaneById(layout.root, selectExplorerSidebarPaneId(state, workspaceKey));
    expect(pane).not.toBeNull();
    const kinds = collectAllTabs(layout.root)
      .filter((tab) => pane!.tabIds.includes(tab.tabId))
      .map((tab) => tab.target.kind);
    expect(kinds).toContain("docs");
    expect(useDesksStore.getState().desks).toBe(desksBefore);
  });
});
