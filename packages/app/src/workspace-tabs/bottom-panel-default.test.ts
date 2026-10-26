// CUSTOM(bottom-panel-warp)
import { describe, expect, it } from "vitest";
import type { WorkspaceLayout } from "@/stores/workspace-layout-actions";
import { bottomPanelWarpBrowserId, resolveBottomPanelWarpTarget } from "./bottom-panel-default";
import type { WorkspaceTabTarget } from "./model";

const warp = {
  id: "warp",
  serverId: "host-a",
  workspacePanels: [{ id: "warp", context: "workspace" }],
};

describe("resolveBottomPanelWarpTarget", () => {
  it("opens the Warp panel in Electron when the host has the Warp plugin", () => {
    expect(
      resolveBottomPanelWarpTarget({ serverId: "host-a", plugins: [warp], isElectron: true }),
    ).toEqual({ kind: "plugin", pluginId: "warp", panelId: "warp", context: "workspace" });
  });

  it("falls back to a terminal outside Electron", () => {
    expect(
      resolveBottomPanelWarpTarget({ serverId: "host-a", plugins: [warp], isElectron: false }),
    ).toBeNull();
  });

  it("falls back to a terminal when the workspace's host lacks the Warp plugin", () => {
    expect(
      resolveBottomPanelWarpTarget({ serverId: "host-b", plugins: [warp], isElectron: true }),
    ).toBeNull();
    expect(
      resolveBottomPanelWarpTarget({
        serverId: "host-a",
        plugins: [{ ...warp, workspacePanels: [] }],
        isElectron: true,
      }),
    ).toBeNull();
  });
});

// CUSTOM(bottom-panel-warp-project-tab)
describe("bottomPanelWarpBrowserId", () => {
  function layoutWithBottomTab(target: WorkspaceTabTarget): WorkspaceLayout {
    const tab = { tabId: "bottom-tab", target, createdAt: 0 };
    return {
      root: {
        kind: "group",
        group: {
          id: "root",
          direction: "vertical",
          sizes: [0.7, 0.3],
          children: [
            { kind: "pane", pane: { id: "main", tabIds: [], focusedTabId: null, tabs: [] } },
            {
              kind: "pane",
              pane: {
                id: "bottom-panel",
                tabIds: ["bottom-tab"],
                focusedTabId: "bottom-tab",
                tabs: [tab],
              },
            },
          ],
        },
      },
      focusedPaneId: "bottom-panel",
    } as unknown as WorkspaceLayout;
  }
  const isWarp = (browserId: string) => browserId === "warp-page";

  it("returns the Warp page the bottom panel shows", () => {
    const layout = layoutWithBottomTab({ kind: "browser", browserId: "warp-page" });
    expect(bottomPanelWarpBrowserId(layout, isWarp)).toBe("warp-page");
  });

  it("ignores other browser tabs and terminals", () => {
    expect(
      bottomPanelWarpBrowserId(layoutWithBottomTab({ kind: "browser", browserId: "docs" }), isWarp),
    ).toBeNull();
    expect(
      bottomPanelWarpBrowserId(layoutWithBottomTab({ kind: "terminal", terminalId: "t1" }), isWarp),
    ).toBeNull();
  });
});
