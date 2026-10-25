// CUSTOM(chat-file-actions): runs a command in a new tab inside the bottom panel's Warp, in a given
// folder. It shows the panel and selects its Warp tab first. Without a bottom panel it asks for one
// (Ctrl+J's action, which opens Warp in it) and waits for Warp to load.
import { useBrowserStore } from "@/desktop/browser/store";
import { activeDesk, useDesksStore } from "@/task-navigation/desks-store";
import { collectAllTabs, findPaneById, type SplitNode } from "@/stores/workspace-layout-actions";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { BOTTOM_PANEL_PANE_ID } from "./bottom-panel";
import { buildWorkspaceTabPersistenceKey } from "./model";
import { openWarpSession } from "./warp-session";

const WAIT_STEP_MS = 250;
const WAIT_LIMIT_MS = 20_000;

export interface WarpRunTarget {
  serverId: string;
  workspaceId: string;
  /** Tasks mode: the bottom panel belongs to the active Desk, not to the workspace. */
  tasksMode: boolean;
}

export type WarpRunResult = "opened" | "no-warp-tab" | "timeout";

interface BottomPanelWarp {
  paneHidden: boolean;
  tabId: string | null;
  browserId: string | null;
}

function findBottomPanelWarp(target: WarpRunTarget): BottomPanelWarp | null {
  const root = layoutRoot(target);
  const pane = root ? findPaneById(root, BOTTOM_PANEL_PANE_ID) : null;
  if (!root || !pane) return null;
  const browsers = useBrowserStore.getState().browsersById;
  const warp = collectAllTabs(root).find(
    (tab) =>
      pane.tabIds.includes(tab.tabId) &&
      tab.target.kind === "browser" &&
      browsers[tab.target.browserId]?.hideToolbar === true,
  );
  return {
    paneHidden: pane.hidden === true,
    tabId: warp?.tabId ?? null,
    browserId: warp?.target.kind === "browser" ? warp.target.browserId : null,
  };
}

function layoutRoot(target: WarpRunTarget): SplitNode | null {
  if (target.tasksMode) return activeDesk(useDesksStore.getState()).layout.root;
  const key = buildWorkspaceTabPersistenceKey(target);
  return key ? (useWorkspaceLayoutStore.getState().layoutByWorkspace[key]?.root ?? null) : null;
}

function showWarpTab(target: WarpRunTarget, tabId: string): void {
  if (target.tasksMode) {
    const desks = useDesksStore.getState();
    desks.focusPane(BOTTOM_PANEL_PANE_ID);
    desks.selectTabInPane(BOTTOM_PANEL_PANE_ID, tabId);
    return;
  }
  const key = buildWorkspaceTabPersistenceKey(target);
  if (!key) return;
  const layout = useWorkspaceLayoutStore.getState();
  layout.focusPane(key, BOTTOM_PANEL_PANE_ID);
  layout.selectTabInPane(key, BOTTOM_PANEL_PANE_ID, tabId);
}

/**
 * `createBottomPanel` runs the bottom-panel toggle; it is only called when there is no bottom
 * panel, so the toggle creates one (with Warp when the host has the plugin).
 */
export async function runInWarp(input: {
  target: WarpRunTarget;
  directory: string;
  command: string;
  createBottomPanel: () => void;
}): Promise<WarpRunResult> {
  const { target, directory, command } = input;
  let warp = findBottomPanelWarp(target);
  if (!warp) {
    input.createBottomPanel();
  } else if (!warp.tabId) {
    return "no-warp-tab";
  }

  const deadline = Date.now() + WAIT_LIMIT_MS;
  let shown = false;
  for (;;) {
    warp = findBottomPanelWarp(target);
    if (warp?.tabId && warp.browserId) {
      if (!shown) {
        showWarpTab(target, warp.tabId);
        shown = true;
      }
      // False until the Warp page has loaded and set its PTY URL.
      if (await openWarpSession(warp.browserId, directory, command)) return "opened";
    }
    if (Date.now() > deadline) return warp && !warp.tabId ? "no-warp-tab" : "timeout";
    await new Promise((resolve) => setTimeout(resolve, WAIT_STEP_MS));
  }
}
