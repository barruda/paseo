// CUSTOM(recent-tabs): "Previous visited tab" / "Next visited tab" walk the tabs in the order you
// last visited them, like Alt+Tab. On web, the walk opens a switcher in the middle of the screen
// (`recent-tab-switcher.tsx`): while the shortcut's modifier stays held, each press moves its
// highlight one tab further, and letting go switches to the highlighted tab and makes it the most
// recent one. Escape closes the switcher without switching. Native has no key release, so each
// press switches right away.
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { isWeb } from "@/constants/platform";
import { queryClient } from "@/data/query-client";
import {
  APP_SETTINGS_QUERY_KEY,
  DEFAULT_CLIENT_SETTINGS,
  type AppSettings,
} from "@/hooks/use-settings/storage";
import { findPaneById, type WorkspaceLayout } from "@/stores/workspace-layout-store";
import { useTabPinsStore } from "@/tab-pins/store";
import type { WorkspaceTab } from "@/workspace-tabs/model";
import { BOTTOM_PANEL_PANE_ID } from "./bottom-panel";
import {
  stepRecentTabWalk,
  walkableTabIds,
  withVisitFirst,
  type RecentTabWalk,
} from "./recent-tabs-model";

// A modifier released inside a browser tab or an HTML preview never reaches this window, so a
// pause this long also ends the walk.
const IDLE_END_MS = 10_000;
const MODIFIER_KEYS = new Set(["Control", "Meta", "Alt", "OS"]);

const visitsByScope = new Map<string, string[]>();
let walk: RecentTabWalk | null = null;
let navigateOnEnd: ((tabId: string) => void) | null = null;
let stopWatchingRelease: (() => void) | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const walkListeners = new Set<() => void>();

function setWalk(next: RecentTabWalk | null): void {
  walk = next;
  for (const listener of walkListeners) listener();
}

function subscribeWalk(listener: () => void): () => void {
  walkListeners.add(listener);
  return () => walkListeners.delete(listener);
}

function getWalk(): RecentTabWalk | null {
  return walk;
}

function getNoWalk(): RecentTabWalk | null {
  return null;
}

/** The walk the switcher shows, while one is going on in `scope`. */
export function useRecentTabWalk(scope: string | null): RecentTabWalk | null {
  const current = useSyncExternalStore(subscribeWalk, getWalk, getNoWalk);
  return current && current.scope === scope ? current : null;
}

/** "Skip pinned tabs" (Settings > Editor), read at press time. */
function skipPinnedTabs(): boolean {
  const settings = queryClient.getQueryData<AppSettings>(APP_SETTINGS_QUERY_KEY);
  return settings?.recentTabsSkipPinned ?? DEFAULT_CLIENT_SETTINGS.recentTabsSkipPinned;
}

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

/**
 * One press of the shortcut. Starts or continues the walk; `navigate` runs with the tab it ends
 * on. Pinned tabs are left out when "Skip pinned tabs" is on (pins share the walk's scope keys).
 */
export function stepRecentTab(input: {
  scope: string;
  openTabIds: readonly string[];
  currentTabId: string | null;
  delta: 1 | -1;
  navigate: (tabId: string) => void;
}): void {
  if (walk && walk.scope !== input.scope) endWalk({ navigate: false });
  const step = stepRecentTabWalk(walk, {
    scope: input.scope,
    openTabIds: walkableTabIds({
      openTabIds: input.openTabIds,
      pinnedTabIds: useTabPinsStore.getState().byScope[input.scope] ?? [],
      skipPinned: skipPinnedTabs(),
    }),
    currentTabId: input.currentTabId,
    delta: input.delta,
    visits: visitsByScope.get(input.scope) ?? [],
  });
  if (!step) return;
  navigateOnEnd = input.navigate;
  setWalk(step.walk);
  if (isWeb) {
    watchRelease();
  } else {
    endWalk({ navigate: true });
  }
}

/** A click on a switcher row: switches to that tab right away. */
export function chooseRecentTab(scope: string, tabId: string): void {
  if (!walk || walk.scope !== scope) return;
  const index = walk.order.indexOf(tabId);
  if (index < 0) return;
  setWalk({ ...walk, index });
  endWalk({ navigate: true });
}

function endWalk(input: { navigate: boolean }): void {
  stopWatchingRelease?.();
  stopWatchingRelease = null;
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = null;
  const ended = walk;
  const navigate = navigateOnEnd;
  navigateOnEnd = null;
  setWalk(null);
  const tabId = ended?.order[ended.index] ?? null;
  if (!ended || !tabId || !input.navigate) return;
  recordTabVisit(ended.scope, tabId);
  navigate?.(tabId);
}

function watchRelease(): void {
  if (idleTimer !== null) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => endWalk({ navigate: true }), IDLE_END_MS);
  if (stopWatchingRelease) return;
  const finish = () => endWalk({ navigate: true });
  const onKeyUp = (event: KeyboardEvent) => {
    if (MODIFIER_KEYS.has(event.key)) finish();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    endWalk({ navigate: false });
  };
  const onPointer = (event: PointerEvent) => {
    if (!event.ctrlKey && !event.metaKey && !event.altKey) finish();
  };
  window.addEventListener("keyup", onKeyUp, true);
  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("pointerdown", onPointer, true);
  window.addEventListener("pointermove", onPointer, true);
  window.addEventListener("blur", finish);
  stopWatchingRelease = () => {
    window.removeEventListener("keyup", onKeyUp, true);
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("pointerdown", onPointer, true);
    window.removeEventListener("pointermove", onPointer, true);
    window.removeEventListener("blur", finish);
  };
}
