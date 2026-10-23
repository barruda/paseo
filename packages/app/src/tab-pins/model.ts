// CUSTOM(tab-pins): pinned tabs sit at the left of their tab row, in pin order.

/**
 * The row order after pinning or unpinning `tabId`. A pinned tab moves right after the pinned tabs
 * already at the left; an unpinned tab moves right after the pinned tabs that remain, so it leads
 * the unpinned ones. `pinned` is the set before the toggle.
 */
export function reorderForPinToggle(input: {
  tabIds: readonly string[];
  pinned: ReadonlySet<string>;
  tabId: string;
}): string[] {
  const { tabIds, pinned, tabId } = input;
  if (!tabIds.includes(tabId)) return [...tabIds];
  const rest = tabIds.filter((id) => id !== tabId);
  let insertAt = 0;
  while (insertAt < rest.length && pinned.has(rest[insertAt]!)) insertAt += 1;
  return [...rest.slice(0, insertAt), tabId, ...rest.slice(insertAt)];
}
