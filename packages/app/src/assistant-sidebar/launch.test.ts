// CUSTOM(assistant-desk)
import { describe, expect, it } from "vitest";
import { launchDeskTarget } from "@/task-navigation/new-tab-menu";
import { collectAllTabs, findPaneById } from "@/stores/workspace-layout-actions";
import {
  selectExplorerSidebarPaneId,
  selectIsExplorerSidebarVisible,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";

function launchIntoExplorer(target: { kind: "docs" } | { kind: "projects_assistant" }): string[] {
  const scope = { serverId: "srv", workspaceId: "ws" };
  const workspaceKey = "srv:ws";
  const store = useWorkspaceLayoutStore.getState();
  store.ensureExplorerSidebar(workspaceKey);
  store.hideExplorerSidebar(workspaceKey);
  expect(selectIsExplorerSidebarVisible(useWorkspaceLayoutStore.getState(), workspaceKey)).toBe(
    false,
  );

  launchDeskTarget(scope, target, { kind: "open" });

  const state = useWorkspaceLayoutStore.getState();
  expect(selectIsExplorerSidebarVisible(state, workspaceKey)).toBe(true);
  const layout = state.layoutByWorkspace[workspaceKey];
  const pane = findPaneById(layout.root, selectExplorerSidebarPaneId(state, workspaceKey));
  return collectAllTabs(layout.root)
    .filter((tab) => pane!.tabIds.includes(tab.tabId))
    .map((tab) => tab.target.kind);
}

describe("launching an Explorer-only panel from the Desk's +", () => {
  it("shows the Explorer even when it was closed, with the Docs", () => {
    expect(launchIntoExplorer({ kind: "docs" })).toContain("docs");
  });

  it("puts the Projects Assistant mirror in the Explorer", () => {
    expect(launchIntoExplorer({ kind: "projects_assistant" })).toContain("projects_assistant");
  });
});
