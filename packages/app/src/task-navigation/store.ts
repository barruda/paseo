// CUSTOM(task-navigation): opt in without changing the existing sidebar's display preferences.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import type { SidebarAgentTab } from "@/board-agents/classify"; // CUSTOM(sidebar-agent-tabs)

interface TaskNavigationState {
  enabled: boolean;
  /** CUSTOM(task-navigation-compact): the phone sidebar's own choice, Tasks list or Workspaces. */
  compactTasks: boolean;
  /** CUSTOM(task-filters-toggle): the arrow beside the tabs hides search, sort and filters. */
  filtersCollapsed: boolean;
  /** CUSTOM(sidebar-agent-tabs): the Tasks sidebar's chosen tab. */
  tab: SidebarAgentTab;
  setEnabled(enabled: boolean): void;
  setCompactTasks(compactTasks: boolean): void;
  setFiltersCollapsed(filtersCollapsed: boolean): void;
  setTab(tab: SidebarAgentTab): void;
}
export const useTaskNavigationStore = create<TaskNavigationState>()(
  persist(
    (set) => ({
      enabled: false,
      compactTasks: true,
      filtersCollapsed: false,
      tab: "user",
      setEnabled: (enabled) => set({ enabled }),
      setCompactTasks: (compactTasks) => set({ compactTasks }),
      setFiltersCollapsed: (filtersCollapsed) => set({ filtersCollapsed }),
      setTab: (tab) => set({ tab }),
    }),
    {
      name: "custom-task-navigation",
      version: 1,
      // Optional so a state saved before a choice existed still loads.
      storage: createValidatedPersistStorage(
        AsyncStorage,
        z.object({
          enabled: z.boolean(),
          compactTasks: z.boolean().optional(),
          filtersCollapsed: z.boolean().optional(),
          tab: z.enum(["user", "orchestrators", "workers"]).optional(),
        }),
      ),
      partialize: (state) => ({
        enabled: state.enabled,
        compactTasks: state.compactTasks,
        filtersCollapsed: state.filtersCollapsed,
        tab: state.tab,
      }),
    },
  ),
);
