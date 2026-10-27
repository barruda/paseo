// CUSTOM(tab-lanes): where each tab sits in its pane's rows, per Desk. Local to this app; the
// daemon knows nothing about tab positions.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import {
  dropOnLanes,
  laneOrder,
  type LanePosition,
  type LanePositions,
  type LaneTab,
} from "./model";

interface TabLanesState {
  /** Positions by scope (the split layout's workspace key, `desk:<id>`), then tab id. */
  byScope: Record<string, LanePositions>;
  setPositions(scope: string, positions: LanePositions): void;
  /** Forgets closed tabs, so their spot stays empty instead of coming back. */
  retain(scope: string, tabIds: ReadonlySet<string>): void;
}

const positionSchema = z.object({ row: z.number(), x: z.number() });

export const useTabLanesStore = create<TabLanesState>()(
  persist(
    (set) => ({
      byScope: {},
      setPositions: (scope, positions) =>
        set((state) => ({
          byScope: { ...state.byScope, [scope]: { ...state.byScope[scope], ...positions } },
        })),
      retain: (scope, tabIds) =>
        set((state) => {
          const current = state.byScope[scope];
          if (!current) return {};
          const kept = Object.entries(current).filter(([id]) => tabIds.has(id));
          if (kept.length === Object.keys(current).length) return {};
          return { byScope: { ...state.byScope, [scope]: Object.fromEntries(kept) } };
        }),
    }),
    {
      name: "custom-tab-lanes",
      version: 1,
      storage: createValidatedPersistStorage(
        AsyncStorage,
        z.object({ byScope: z.record(z.string(), z.record(z.string(), positionSchema)) }),
      ),
      partialize: (state) => ({ byScope: state.byScope }),
    },
  ),
);

// What each mounted pane last laid out: its tabs with their widths and its row width. A drop is
// committed by the split container, which doesn't measure tabs.
interface PaneMetrics {
  tabs: LaneTab[];
  width: number;
  gap: number;
}
const metricsByPane = new Map<string, PaneMetrics>();
const paneKey = (scope: string, paneId: string) => `${scope}\n${paneId}`;

export function setLanePaneMetrics(scope: string, paneId: string, metrics: PaneMetrics | null) {
  if (metrics) metricsByPane.set(paneKey(scope, paneId), metrics);
  else metricsByPane.delete(paneKey(scope, paneId));
}

export function laneTabWidth(scope: string, tabId: string): number | null {
  for (const [key, metrics] of metricsByPane) {
    if (!key.startsWith(`${scope}\n`)) continue;
    const tab = metrics.tabs.find((entry) => entry.id === tabId);
    if (tab) return tab.width;
  }
  return null;
}

/**
 * Puts `tabId` at (row, x) in the pane and saves every tab's spot there. Returns the pane's tab
 * ids in row order, or null when the pane isn't mounted.
 */
export function commitLaneDrop(input: {
  scope: string;
  paneId: string;
  tabId: string;
  target: LanePosition;
}): string[] | null {
  const metrics = metricsByPane.get(paneKey(input.scope, input.paneId));
  const tabWidth = laneTabWidth(input.scope, input.tabId);
  if (!metrics || tabWidth === null) return null;
  const store = useTabLanesStore.getState();
  const layout = dropOnLanes({
    tabs: metrics.tabs,
    positions: store.byScope[input.scope] ?? {},
    width: metrics.width,
    gap: metrics.gap,
    tabId: input.tabId,
    tabWidth,
    row: input.target.row,
    x: input.target.x,
  });
  store.setPositions(input.scope, layout.positions);
  return laneOrder(layout.positions, Object.keys(layout.positions));
}

/** A pinned tab moves to the start of the first row, right after the tabs pinned before it. */
export function commitLanePin(input: {
  scope: string;
  paneId: string;
  tabId: string;
  pinnedIds: readonly string[];
}): void {
  const positions = useTabLanesStore.getState().byScope[input.scope] ?? {};
  let x = 0;
  for (const id of input.pinnedIds) {
    const spot = positions[id];
    const width = laneTabWidth(input.scope, id);
    if (id === input.tabId || !spot || spot.row !== 0 || width === null) continue;
    x = Math.max(x, spot.x + width);
  }
  commitLaneDrop({
    scope: input.scope,
    paneId: input.paneId,
    tabId: input.tabId,
    target: { row: 0, x },
  });
}
