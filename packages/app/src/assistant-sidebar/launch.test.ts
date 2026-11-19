// CUSTOM(assistant-sidebar)
import { describe, expect, it } from "vitest";
import { launchDeskTarget } from "@/task-navigation/new-tab-menu";
import { collectAllTabs, findPaneById } from "@/stores/workspace-layout-actions";
import {
  selectExplorerSidebarPaneId,
  selectIsExplorerSidebarVisible,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";

describe("launching the Projects Assistant from the Desk's +", () => {
  it("shows the Explorer even when it was closed", () => {
    const scope = { serverId: "srv", workspaceId: "ws" };
    const workspaceKey = "srv:ws";
    const store = useWorkspaceLayoutStore.getState();
    store.ensureExplorerSidebar(workspaceKey);
    store.hideExplorerSidebar(workspaceKey);
    expect(selectIsExplorerSidebarVisible(useWorkspaceLayoutStore.getState(), workspaceKey)).toBe(
      false,
    );

    launchDeskTarget(scope, { kind: "projects_assistant" }, { kind: "open" });

    const state = useWorkspaceLayoutStore.getState();
    expect(selectIsExplorerSidebarVisible(state, workspaceKey)).toBe(true);
    const layout = state.layoutByWorkspace[workspaceKey];
    const pane = findPaneById(layout.root, selectExplorerSidebarPaneId(state, workspaceKey));
    const kinds = collectAllTabs(layout.root)
      .filter((tab) => pane!.tabIds.includes(tab.tabId))
      .map((tab) => tab.target.kind);
    expect(kinds).toContain("projects_assistant");
  });
});
