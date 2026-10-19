// CUSTOM(bottom-panel-tab-keys): Ctrl+Tab and Ctrl+Shift+Tab belong to a page in the bottom
// panel. Warp cycles its own sessions with them and leaves them unprevented for the browser, so
// without this Paseo also switched its tabs on the same press.
import {
  collectAllTabs,
  findPaneContainingTab,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-actions";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { useDesksStore } from "@/task-navigation/desks-store";
import { BOTTOM_PANEL_PANE_ID } from "./bottom-panel";

interface TabCycleKeyInput {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
}

export function isTabCycleKey(input: TabCycleKeyInput): boolean {
  return input.key === "Tab" && input.ctrlKey === true && !input.metaKey && !input.altKey;
}

export function layoutHasBrowserInBottomPanel(layout: WorkspaceLayout, browserId: string): boolean {
  return collectAllTabs(layout.root).some(
    (tab) =>
      tab.target.kind === "browser" &&
      tab.target.browserId === browserId &&
      findPaneContainingTab(layout.root, tab.tabId)?.id === BOTTOM_PANEL_PANE_ID,
  );
}

/** Whether the browser sits in a bottom panel of any workspace or Desk. */
export function isBrowserInBottomPanel(browserId: string): boolean {
  const layouts = [
    ...Object.values(useWorkspaceLayoutStore.getState().layoutByWorkspace),
    ...useDesksStore.getState().desks.map((desk) => desk.layout),
  ];
  return layouts.some((layout) => layout && layoutHasBrowserInBottomPanel(layout, browserId));
}
