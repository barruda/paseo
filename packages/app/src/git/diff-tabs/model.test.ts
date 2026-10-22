import { describe, expect, it } from "vitest";
import type { SplitNode, WorkspaceLayout } from "@/stores/workspace-layout-actions";
import { BOTTOM_PANEL_PANE_ID } from "@/workspace-tabs/bottom-panel";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { findDiffTabToReuse, isInBottomPanel, resolveMainContentPaneId } from "./model";

const fileDiff: WorkspaceTabTarget = {
  kind: "working_diff",
  focusPath: "src/b.ts",
  focusRequestId: 2,
};
const tabs = [
  { id: "agent", target: { kind: "agent", agentId: "a1" } as WorkspaceTabTarget },
  { id: "diff", target: { kind: "working_diff", focusPath: "src/a.ts", focusRequestId: 1 } },
] satisfies { id: string; target: WorkspaceTabTarget }[];

describe("findDiffTabToReuse", () => {
  it("reuses the open diff tab when Open in different tabs is off", () => {
    expect(findDiffTabToReuse({ tabs, target: fileDiff, openInNewTabs: false })?.id).toBe("diff");
  });

  it("opens a new tab when Open in different tabs is on", () => {
    expect(findDiffTabToReuse({ tabs, target: fileDiff, openInNewTabs: true })).toBeNull();
  });

  it("opens a new tab when no diff tab is open", () => {
    expect(
      findDiffTabToReuse({ tabs: tabs.slice(0, 1), target: fileDiff, openInNewTabs: false }),
    ).toBeNull();
  });

  it("leaves other targets and the whole-diff tab alone", () => {
    const file: WorkspaceTabTarget = { kind: "file", path: "src/a.ts" };
    const wholeDiff: WorkspaceTabTarget = { kind: "working_diff" };
    expect(findDiffTabToReuse({ tabs, target: file, openInNewTabs: false })).toBeNull();
    expect(findDiffTabToReuse({ tabs, target: wholeDiff, openInNewTabs: false })).toBeNull();
  });
});

// CUSTOM(changes-main-content)
function pane(id: string, tabIds: string[], hidden?: boolean): SplitNode {
  const paneTabs = tabIds.map((tabId) => ({
    tabId,
    target: { kind: "agent", agentId: tabId },
    createdAt: 0,
  }));
  return {
    kind: "pane",
    pane: {
      id,
      tabIds,
      focusedTabId: tabIds[0] ?? null,
      tabs: paneTabs,
      ...(hidden ? { hidden } : {}),
    },
  } as SplitNode;
}

function deskLayout(focusedPaneId: string): WorkspaceLayout {
  return {
    focusedPaneId,
    root: {
      kind: "group",
      group: {
        id: "root",
        direction: "vertical",
        sizes: [0.7, 0.3],
        children: [
          {
            kind: "group",
            group: {
              id: "top",
              direction: "horizontal",
              sizes: [0.5, 0.5],
              children: [pane("left", ["agent-a"]), pane("right", ["agent-b"])],
            },
          },
          pane(BOTTOM_PANEL_PANE_ID, ["terminal", "old-diff"]),
        ],
      },
    },
  };
}

describe("main content pane", () => {
  it("knows which tabs sit in the bottom panel", () => {
    const layout = deskLayout("left");
    expect(isInBottomPanel(layout.root, "old-diff")).toBe(true);
    expect(isInBottomPanel(layout.root, "agent-a")).toBe(false);
  });

  it("opens in the context tab's pane while the bottom panel has focus", () => {
    expect(resolveMainContentPaneId(deskLayout(BOTTOM_PANEL_PANE_ID), "agent-b")).toBe("right");
  });

  it("falls back to the focused pane, then the first pane, never the bottom panel", () => {
    expect(resolveMainContentPaneId(deskLayout("right"), null)).toBe("right");
    expect(resolveMainContentPaneId(deskLayout(BOTTOM_PANEL_PANE_ID), null)).toBe("left");
    expect(resolveMainContentPaneId(deskLayout(BOTTOM_PANEL_PANE_ID), "terminal")).toBe("left");
  });
});
