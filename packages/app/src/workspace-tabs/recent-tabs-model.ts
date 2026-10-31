// CUSTOM(recent-tabs): visit order of the tabs in one workspace or Desk, and the walk through it
// that the "Previous visited tab" / "Next visited tab" shortcuts make.

const MAX_VISITS = 50;

/** One press-and-hold of the shortcut: the order it walks, frozen when the walk starts. */
export interface RecentTabWalk {
  scope: string;
  order: string[];
  index: number;
}

/** The visits with `tabId` moved to the front, most recent first. */
export function withVisitFirst(visits: readonly string[], tabId: string): string[] {
  return [tabId, ...visits.filter((id) => id !== tabId)].slice(0, MAX_VISITS);
}

/**
 * The open tabs in visit order: the current tab, the other visited tabs still open, then the
 * open tabs never visited, in their own order so the walk still reaches every tab.
 */
export function recentTabOrder(input: {
  visits: readonly string[];
  openTabIds: readonly string[];
  currentTabId: string | null;
}): string[] {
  const open = new Set(input.openTabIds);
  const visited = input.visits.filter((id) => open.has(id));
  const head =
    input.currentTabId && open.has(input.currentTabId)
      ? [input.currentTabId, ...visited.filter((id) => id !== input.currentTabId)]
      : visited;
  const inHead = new Set(head);
  return [...head, ...input.openTabIds.filter((id) => !inHead.has(id))];
}

/**
 * One press: continues the walk when it is in the same scope, otherwise starts a new one from
 * the current tab. Returns `null` when the scope has fewer than two open tabs.
 */
export function stepRecentTabWalk(
  walk: RecentTabWalk | null,
  input: {
    scope: string;
    visits: readonly string[];
    openTabIds: readonly string[];
    currentTabId: string | null;
    delta: 1 | -1;
  },
): { walk: RecentTabWalk; tabId: string } | null {
  const current =
    walk && walk.scope === input.scope
      ? walk
      : { scope: input.scope, order: recentTabOrder(input), index: 0 };
  const length = current.order.length;
  if (length < 2) return null;
  const index = (current.index + input.delta + length) % length;
  return { walk: { ...current, index }, tabId: current.order[index]! };
}
