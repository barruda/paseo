// CUSTOM(bottom-panel)
import { describe, expect, it } from "vitest";
import { resolveKeyboardShortcut } from "@/keyboard/keyboard-shortcuts";
import { routeKeyboardShortcut } from "@/keyboard/route-shortcut";
import {
  closePaneInLayout,
  collectAllPanes,
  createWorkspaceLayoutWithExplorerSidebar,
  DEFAULT_PANE_ID,
  EXPLORER_SIDEBAR_PANE_ID,
  findPaneById,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-actions";
import { BOTTOM_PANEL_PANE_ID, toggleBottomPanelInLayout } from "@/workspace-tabs/bottom-panel";

let nodeCounter = 0;
function createNodeId(prefix: string): string {
  nodeCounter += 1;
  return `${prefix}-${nodeCounter}`;
}

function toggle(layout: WorkspaceLayout) {
  return toggleBottomPanelInLayout({
    layout,
    explorerSidebarPaneId: EXPLORER_SIDEBAR_PANE_ID,
    createNodeId,
  });
}

function toggleOrThrow(layout: WorkspaceLayout) {
  const result = toggle(layout);
  if (!result) throw new Error("toggle was refused");
  return result;
}

describe("bottom panel", () => {
  it("creates a full-width pane under the whole workspace tree with a launcher tab", () => {
    const layout = createWorkspaceLayoutWithExplorerSidebar();
    const result = toggleOrThrow(layout);

    expect(result.kind).toBe("created");
    const root = result.layout.root;
    expect(root.kind === "group" && root.group.direction).toBe("vertical");
    if (root.kind !== "group") return;
    expect(root.group.children[0]).toEqual(layout.root);
    const pane = findPaneById(result.layout.root, BOTTOM_PANEL_PANE_ID);
    expect(pane?.hidden).toBeUndefined();
    expect(result.layout.focusedPaneId).toBe(BOTTOM_PANEL_PANE_ID);
    expect(result.kind === "created" && result.launcherTabId).toBe(pane?.focusedTabId);
  });

  it("hides and shows the same pane, keeping its tabs", () => {
    const created = toggleOrThrow(createWorkspaceLayoutWithExplorerSidebar());
    const tabIds = findPaneById(created.layout.root, BOTTOM_PANEL_PANE_ID)?.tabIds;

    const hidden = toggleOrThrow(created.layout);
    expect(hidden.kind).toBe("hidden");
    expect(findPaneById(hidden.layout.root, BOTTOM_PANEL_PANE_ID)?.hidden).toBe(true);
    expect(hidden.layout.focusedPaneId).toBe(DEFAULT_PANE_ID);

    const shown = toggleOrThrow(hidden.layout);
    expect(shown.kind).toBe("shown");
    const pane = findPaneById(shown.layout.root, BOTTOM_PANEL_PANE_ID);
    expect(pane?.hidden).toBeUndefined();
    expect(pane?.tabIds).toEqual(tabIds);
    expect(shown.layout.focusedPaneId).toBe(BOTTOM_PANEL_PANE_ID);
  });

  it("keeps focus where it was when hiding an unfocused panel", () => {
    const created = toggleOrThrow(createWorkspaceLayoutWithExplorerSidebar());
    const hidden = toggleOrThrow({ ...created.layout, focusedPaneId: DEFAULT_PANE_ID });
    expect(hidden.layout.focusedPaneId).toBe(DEFAULT_PANE_ID);
  });

  it("refuses to hide the last ordinary pane", () => {
    const created = toggleOrThrow(createWorkspaceLayoutWithExplorerSidebar());
    const withoutMain = closePaneInLayout({
      layout: created.layout,
      paneId: DEFAULT_PANE_ID,
      explorerSidebarPaneId: EXPLORER_SIDEBAR_PANE_ID,
    });
    if (!withoutMain) throw new Error("closing the main pane was refused");
    expect(collectAllPanes(withoutMain.root).map((pane) => pane.id)).not.toContain(DEFAULT_PANE_ID);

    expect(toggle(withoutMain)).toBeNull();
  });

  it("creates a new panel after the old one was closed", () => {
    const created = toggleOrThrow(createWorkspaceLayoutWithExplorerSidebar());
    const closed = closePaneInLayout({
      layout: created.layout,
      paneId: BOTTOM_PANEL_PANE_ID,
      explorerSidebarPaneId: EXPLORER_SIDEBAR_PANE_ID,
    });
    if (!closed) throw new Error("closing the bottom panel was refused");
    expect(findPaneById(closed.root, BOTTOM_PANEL_PANE_ID)).toBeNull();

    expect(toggleOrThrow(closed).kind).toBe("created");
  });

  it.each([
    { name: "Ctrl+J on Linux", isMac: false, ctrlKey: true, metaKey: false },
    { name: "Cmd+J on macOS", isMac: true, ctrlKey: false, metaKey: true },
  ])("binds $name, including from a focused terminal", ({ isMac, ctrlKey, metaKey }) => {
    const result = resolveKeyboardShortcut({
      event: {
        key: "j",
        code: "KeyJ",
        altKey: false,
        ctrlKey,
        metaKey,
        shiftKey: false,
        repeat: false,
      },
      context: { isMac, isDesktop: true, focusScope: "terminal", commandCenterOpen: false },
      chordState: { candidateIndices: [], step: 0, timeoutId: null },
      onChordReset: () => undefined,
    });

    expect(result.match?.action).toBe("workspace.bottom-panel.toggle");
    expect(
      routeKeyboardShortcut(
        { action: "workspace.bottom-panel.toggle", payload: null },
        {
          pathname: "/",
          isMobile: false,
          sidebarShortcutTargets: [],
          navigationActiveWorkspace: null,
          commandCenterOpen: false,
          shortcutsDialogOpen: false,
        },
      ),
    ).toEqual({
      kind: "dispatch",
      action: { id: "workspace.bottom-panel.toggle", scope: "workspace" },
    });
  });
});
