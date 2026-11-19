// CUSTOM(desk-workboard): the state of the plugin surface chips beside the Desks: which are open,
// which one shows, and Power Workboard's inner tab. Kept apart from desk-workboard.tsx so plugin
// navigation can import it without the surface renderer and the plugin registry.
// CUSTOM(workboard-chip-only): in Tasks mode, opening Power Workboard from anywhere selects the chip.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { navigateToHostWorkspaceRoute } from "@/navigation/workspace-route-navigation";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import { getLastWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { buildHostWorkspaceRoute } from "@/utils/host-routes";
import {
  deskSurfacesStorageSchema,
  isWorkboardPanel,
  migrateDeskSurfaces,
  resolveDeskSurfaceTarget,
  resolveWorkboardOpen,
} from "./desk-workboard-model";
import { useTaskNavigationStore } from "./store";

interface DeskWorkboardState {
  /** Surface id -> its tab is in the header; closed ones are reopened from +. Missing means open. */
  open: Record<string, boolean>;
  /** The surface showing instead of the Desk's tabs. */
  selected: string | null;
  /** Power Workboard's inner tab; the board reports it on every change. */
  tab: string | null;
  /**
   * CUSTOM(workboard-chip-only): bumped by every select. A Desk tab change in the same update
   * (closing the + launcher tab, a route change) then does not undo the select. Not persisted.
   */
  revision: number;
  /**
   * CUSTOM(workboard-chip-only): changes on every tab an open asks for, passed to the board as
   * `params.request` so it switches even when `tab` already holds that value. Not persisted.
   */
  tabRequest: string | null;
  select(id: string): void;
  deselect(): void;
  close(id: string): void;
  reopen(id: string): void;
  /** Reopens and selects a chip; an inner page's id selects Power Workboard on that tab. */
  openSurface(id: string): void;
  setTab(tab: string): void;
  requestTab(tab: string, request: string): void;
}
export const useDeskWorkboardStore = create<DeskWorkboardState>()(
  persist(
    (set) => ({
      open: {},
      selected: null,
      tab: null,
      revision: 0,
      tabRequest: null,
      select: (id) =>
        set((state) => ({
          open: { ...state.open, [id]: true },
          selected: id,
          revision: state.revision + 1,
        })),
      deselect: () => set((state) => (state.selected ? { selected: null } : state)),
      close: (id) =>
        set((state) => ({
          open: { ...state.open, [id]: false },
          selected: state.selected === id ? null : state.selected,
        })),
      reopen: (id) =>
        set((state) => ({
          open: { ...state.open, [id]: true },
          selected: id,
          revision: state.revision + 1,
        })),
      openSurface: (id) => {
        const target = resolveDeskSurfaceTarget(id);
        set((state) => ({
          open: { ...state.open, [target.surfaceId]: true },
          selected: target.surfaceId,
          tab: target.tab ?? state.tab,
          revision: state.revision + 1,
        }));
      },
      setTab: (tab) => set((state) => (state.tab === tab ? state : { tab })),
      requestTab: (tab, request) => set({ tab, tabRequest: request }),
    }),
    {
      name: "custom-desk-workboard",
      version: 3,
      migrate: (persisted) => migrateDeskSurfaces(persisted),
      storage: createValidatedPersistStorage(AsyncStorage, deskSurfacesStorageSchema),
      partialize: (state) => ({ open: state.open, selected: state.selected, tab: state.tab }),
    },
  ),
);

/**
 * CUSTOM(workboard-chip-only): in Tasks mode, selects the Power Workboard chip for an open of one
 * of its screens and shows the Desk (the last workspace's route). False when the open is not the
 * board's, outside Tasks mode, or before any workspace was shown; the caller then opens it as usual.
 */
export function openWorkboardInDesk(input: {
  pluginId: string;
  screenId: string;
  params?: Readonly<Record<string, string>>;
}): boolean {
  const target = resolveWorkboardOpen({
    tasksMode: useTaskNavigationStore.getState().enabled,
    ...input,
  });
  const last = getLastWorkspaceSelection();
  if (!target || !last) return false;
  const store = useDeskWorkboardStore.getState();
  store.openSurface(target.surfaceId);
  if (target.tab)
    store.requestTab(
      target.tab,
      input.params?.request ?? String(useDeskWorkboardStore.getState().revision),
    );
  navigateToHostWorkspaceRoute(buildHostWorkspaceRoute(last.serverId, last.workspaceId));
  return true;
}

/** CUSTOM(workboard-chip-only): the board's workspace panel selects the chip in Tasks mode. */
export function openWorkboardPanelInDesk(pluginId: string, panelId: string): boolean {
  return (
    isWorkboardPanel(pluginId, panelId) && openWorkboardInDesk({ pluginId, screenId: panelId })
  );
}
