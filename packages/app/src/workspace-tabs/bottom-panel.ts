// CUSTOM(bottom-panel): a VS Code style bottom panel toggled with Ctrl/Cmd+J.
//
// The panel is an ordinary workspace pane with a fixed id, split full-width under the whole
// workspace tree. Toggling flips the pane's `hidden` flag, so its tabs (terminals included) stay
// mounted and keep running while it is out of sight. Closing its last tab removes the pane like
// any other, and the next toggle creates a fresh one.
import { supportsDesktopPaneSplits } from "@/constants/layout";
import { isWeb } from "@/constants/platform";
import {
  focusPaneInLayout,
  setPaneHiddenInLayout,
  splitWorkspaceRootBottomInLayout,
} from "@/stores/workspace-layout-actions";
import { defaultWorkspaceLayoutIds } from "@/stores/workspace-layout-ids";
import type { WorkspaceLayoutNodeIdPrefix } from "@/stores/workspace-layout-ids";
import {
  collectAllPanes,
  createWorkspaceLayoutWithExplorerSidebar,
  findPaneById,
  normalizeLayout,
  selectExplorerSidebarPaneId,
  useWorkspaceLayoutStore,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-store";

export const BOTTOM_PANEL_PANE_ID = "bottom-panel";

// Same limit as the layout store's MAX_TREE_DEPTH.
const MAX_TREE_DEPTH = 5;

export type BottomPanelToggleResult =
  | { kind: "created"; layout: WorkspaceLayout; launcherTabId: string }
  | { kind: "shown"; layout: WorkspaceLayout }
  | { kind: "hidden"; layout: WorkspaceLayout };

export function toggleBottomPanelInLayout(input: {
  layout: WorkspaceLayout;
  explorerSidebarPaneId: string | null;
  createNodeId: (prefix: WorkspaceLayoutNodeIdPrefix) => string;
}): BottomPanelToggleResult | null {
  const { layout } = input;
  const pane = findPaneById(layout.root, BOTTOM_PANEL_PANE_ID);

  if (!pane) {
    const result = splitWorkspaceRootBottomInLayout({
      layout,
      paneId: BOTTOM_PANEL_PANE_ID,
      createNodeId: input.createNodeId,
      maxTreeDepth: MAX_TREE_DEPTH,
    });
    const launcherTabId = result
      ? findPaneById(result.layout.root, BOTTOM_PANEL_PANE_ID)?.focusedTabId
      : null;
    return result && launcherTabId
      ? { kind: "created", layout: result.layout, launcherTabId }
      : null;
  }

  if (pane.hidden === true) {
    const shown = focusPaneInLayout({ layout, paneId: pane.id });
    return shown ? { kind: "shown", layout: shown } : null;
  }

  // The workspace canvas never goes empty: hiding needs another ordinary pane to look at.
  const mainPane = collectAllPanes(layout.root).find(
    (candidate) => candidate.id !== pane.id && candidate.id !== input.explorerSidebarPaneId,
  );
  if (!mainPane) return null;
  const hidden = setPaneHiddenInLayout({ layout, paneId: pane.id, hidden: true });
  if (!hidden) return null;
  return {
    kind: "hidden",
    layout: layout.focusedPaneId === pane.id ? { ...hidden, focusedPaneId: mainPane.id } : hidden,
  };
}

/**
 * Shows, hides, or creates the workspace's bottom panel. Returns the launcher tab of a newly
 * created panel so the caller can fill it (the workspace screen opens a terminal there).
 */
export function toggleBottomPanel(input: {
  workspaceKey: string | null;
  isCompact: boolean;
}): BottomPanelToggleResult | null {
  const { workspaceKey } = input;
  if (!workspaceKey || input.isCompact || !supportsDesktopPaneSplits()) return null;

  const state = useWorkspaceLayoutStore.getState();
  const result = toggleBottomPanelInLayout({
    layout: normalizeLayout(
      state.layoutByWorkspace[workspaceKey] ?? createWorkspaceLayoutWithExplorerSidebar(),
    ),
    explorerSidebarPaneId: selectExplorerSidebarPaneId(state, workspaceKey),
    createNodeId: defaultWorkspaceLayoutIds.createNodeId,
  });
  if (!result) return null;

  useWorkspaceLayoutStore.setState((current) => {
    // A pending focus restore could otherwise point back at the pane we just hid and unhide it.
    const { [workspaceKey]: _restore, ...focusRestorationByWorkspace } =
      current.focusRestorationByWorkspace;
    return {
      layoutByWorkspace: { ...current.layoutByWorkspace, [workspaceKey]: result.layout },
      focusRestorationByWorkspace,
    };
  });
  if (result.kind === "hidden") releaseFocusFromBottomPanel();
  return result;
}

// A hidden pane stays mounted at zero size, so a terminal inside it would keep the keyboard and
// swallow what the user types next. split-container renders each pane with this testID.
function releaseFocusFromBottomPanel(): void {
  if (!isWeb) return;
  const pane = document.querySelector(`[data-testid="workspace-pane-${BOTTOM_PANEL_PANE_ID}"]`);
  const active = document.activeElement;
  if (pane && active instanceof HTMLElement && pane.contains(active)) active.blur();
}
