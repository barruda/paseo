// CUSTOM(changes-diff-tab): which open tab a Changes file click reuses.
import {
  collectAllPanes,
  findPaneById,
  findPaneContainingTab,
  type SplitNode,
  type SplitPane,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-actions";
import { BOTTOM_PANEL_PANE_ID } from "@/workspace-tabs/bottom-panel";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";

/**
 * The diff tab to retarget at `target`, or null to open a new tab. Only a file diff opened from
 * the Changes tree (a working diff with a focus path) reuses a tab, and only when "Open in
 * different tabs" is off.
 */
export function findDiffTabToReuse<T extends { target: WorkspaceTabTarget }>(input: {
  tabs: readonly T[];
  target: WorkspaceTabTarget;
  openInNewTabs: boolean;
}): T | null {
  if (input.openInNewTabs) return null;
  if (input.target.kind !== "working_diff" || !input.target.focusPath) return null;
  return input.tabs.find((tab) => tab.target.kind === "working_diff") ?? null;
}

/** A tab in the bottom panel; Changes clicks neither open into nor reuse those. */
export function isInBottomPanel(root: SplitNode, tabId: string): boolean {
  return findPaneContainingTab(root, tabId)?.id === BOTTOM_PANEL_PANE_ID;
}

/**
 * The pane an Explorer click opens into: the context tab's pane, else the focused pane, else the
 * first visible one, never the bottom panel.
 */
export function resolveMainContentPaneId(
  layout: WorkspaceLayout,
  contextTabId: string | null,
): string | undefined {
  const isMain = (pane: SplitPane | null): pane is SplitPane =>
    pane !== null && pane.id !== BOTTOM_PANEL_PANE_ID && pane.hidden !== true;
  const contextPane = contextTabId ? findPaneContainingTab(layout.root, contextTabId) : null;
  if (isMain(contextPane)) return contextPane.id;
  const focusedPane = findPaneById(layout.root, layout.focusedPaneId);
  if (isMain(focusedPane)) return focusedPane.id;
  return collectAllPanes(layout.root).find(isMain)?.id;
}
