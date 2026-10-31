// CUSTOM(recent-tabs): "Previous visited tab" / "Next visited tab" walk the tabs in the order you
// last visited them, like Alt+Tab. While the shortcut's modifier stays held, each press goes one
// tab further; letting go makes the tab you landed on the most recent one. The tabs passed on
// the way are not recorded as visits.
import { useEffect, useMemo } from "react";
import { isWeb } from "@/constants/platform";
import { findPaneById, type WorkspaceLayout } from "@/stores/workspace-layout-store";
import type { WorkspaceTab } from "@/workspace-tabs/model";
import { BOTTOM_PANEL_PANE_ID } from "./bottom-panel";
import { stepRecentTabWalk, withVisitFirst, type RecentTabWalk } from "./recent-tabs-model";

// A modifier released inside a browser tab or an HTML preview never reaches this window, so a
// pause this long also ends the walk.
const IDLE_END_MS = 2000;
const MODIFIER_KEYS = new Set(["Control", "Meta", "Alt", "OS"]);

const visitsByScope = new Map<string, string[]>();
let walk: RecentTabWalk | null = null;
let stopWatchingRelease: (() => void) | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * The tabs the walk goes through: the main content's. Tabs in the bottom panel (of a workspace or
 * a Desk) and in the Explorer pane are left out, so the walk never reopens a panel you closed.
 */
export function mainContentTabIds(input: {
  layout: WorkspaceLayout;
  tabIds: readonly string[];
  explorerSidebarPaneId?: string | null;
}): string[] {
  const sidePaneTabIds = new Set(
    [BOTTOM_PANEL_PANE_ID, input.explorerSidebarPaneId].flatMap(
      (paneId) => findPaneById(input.layout.root, paneId)?.tabIds ?? [],
    ),
  );
  return input.tabIds.filter((tabId) => !sidePaneTabIds.has(tabId));
}

/** `tabId` when it is one of the main content's tabs, otherwise `null`. */
export function mainContentTabId(layout: WorkspaceLayout, tabId: string | null): string | null {
  if (!tabId) return null;
  return mainContentTabIds({ layout, tabIds: [tabId] }).length > 0 ? tabId : null;
}

/** The workspace's main content tabs, and the active one among them, recorded as a visit. */
export function useWorkspaceRecentTabs(input: {
  workspaceKey: string | null;
  layout: WorkspaceLayout | null;
  tabs: readonly WorkspaceTab[];
  explorerSidebarPaneId: string | null;
  activeTabId: string | null;
}): { recentTabIds: string[]; recentCurrentTabId: string | null } {
  const { workspaceKey, layout, tabs, explorerSidebarPaneId, activeTabId } = input;
  const recentTabIds = useMemo(
    () =>
      layout
        ? mainContentTabIds({
            layout,
            tabIds: tabs.map((tab) => tab.tabId),
            explorerSidebarPaneId,
          })
        : [],
    [explorerSidebarPaneId, layout, tabs],
  );
  const recentCurrentTabId = activeTabId && recentTabIds.includes(activeTabId) ? activeTabId : null;
  useEffect(() => {
    if (workspaceKey) recordTabVisit(workspaceKey, recentCurrentTabId);
  }, [recentCurrentTabId, workspaceKey]);
  return { recentTabIds, recentCurrentTabId };
}

/** Records `tabId` as the most recent tab of `scope` (a workspace or a Desk). */
export function recordTabVisit(scope: string, tabId: string | null): void {
  if (!tabId || walk?.scope === scope) return;
  visitsByScope.set(scope, withVisitFirst(visitsByScope.get(scope) ?? [], tabId));
}

/** The tab one step along the visit order, or `null` when there is nowhere to go. */
export function stepRecentTab(input: {
  scope: string;
  openTabIds: readonly string[];
  currentTabId: string | null;
  delta: 1 | -1;
}): string | null {
  if (walk && walk.scope !== input.scope) endWalk();
  const step = stepRecentTabWalk(walk, {
    ...input,
    visits: visitsByScope.get(input.scope) ?? [],
  });
  if (!step) return null;
  walk = step.walk;
  if (isWeb) {
    watchRelease();
  } else {
    endWalk();
  }
  return step.tabId;
}

function endWalk(): void {
  stopWatchingRelease?.();
  stopWatchingRelease = null;
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = null;
  const ended = walk;
  walk = null;
  if (ended) recordTabVisit(ended.scope, ended.order[ended.index] ?? null);
}

function watchRelease(): void {
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = setTimeout(endWalk, IDLE_END_MS);
  if (stopWatchingRelease) return;
  const onKeyUp = (event: KeyboardEvent) => {
    if (MODIFIER_KEYS.has(event.key)) endWalk();
  };
  const onPointer = (event: PointerEvent) => {
    if (!event.ctrlKey && !event.metaKey && !event.altKey) endWalk();
  };
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("pointerdown", onPointer, true);
  window.addEventListener("pointermove", onPointer, true);
  window.addEventListener("blur", endWalk);
  stopWatchingRelease = () => {
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("pointerdown", onPointer, true);
    window.removeEventListener("pointermove", onPointer, true);
    window.removeEventListener("blur", endWalk);
  };
}
