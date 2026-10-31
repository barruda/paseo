// CUSTOM(recent-tabs): "Previous visited tab" / "Next visited tab" walk the tabs in the order you
// last visited them, like Alt+Tab. While the shortcut's modifier stays held, each press goes one
// tab further; letting go makes the tab you landed on the most recent one. The tabs passed on
// the way are not recorded as visits.
import { isWeb } from "@/constants/platform";
import { stepRecentTabWalk, withVisitFirst, type RecentTabWalk } from "./recent-tabs-model";

// A modifier released inside a browser tab or an HTML preview never reaches this window, so a
// pause this long also ends the walk.
const IDLE_END_MS = 2000;
const MODIFIER_KEYS = new Set(["Control", "Meta", "Alt", "OS"]);

const visitsByScope = new Map<string, string[]>();
let walk: RecentTabWalk | null = null;
let stopWatchingRelease: (() => void) | null = null;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

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
