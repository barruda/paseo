// CUSTOM(tab-pins): the pins of one tab row owner, and the toggle that reorders the row.
import { useMemo } from "react";
import { useShallow } from "zustand/shallow";
import { useTabPinsStore } from "./store";
import { reorderForPinToggle } from "./model";

const NO_PINS: string[] = [];

export interface TabPins {
  isPinned(tabId: string): boolean;
  /** Pins or unpins `tabId` and returns the new order of `tabIds`. */
  toggle(tabId: string, tabIds: readonly string[]): string[];
}

/** Null without a scope, where tabs offer no pin. */
export function useTabPins(scope: string | null): TabPins | null {
  const pinnedIds = useTabPinsStore(
    useShallow((state) => (scope ? (state.byScope[scope] ?? NO_PINS) : NO_PINS)),
  );
  return useMemo(() => {
    if (!scope) return null;
    const pinned = new Set(pinnedIds);
    return {
      isPinned: (tabId) => pinned.has(tabId),
      toggle: (tabId, tabIds) => {
        const pinning = !pinned.has(tabId);
        useTabPinsStore.getState().setPinned(scope, tabId, pinning);
        return reorderForPinToggle({ tabIds, pinned, tabId });
      },
    };
  }, [scope, pinnedIds]);
}
