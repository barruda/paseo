// CUSTOM(task-navigation): opt in without changing the existing sidebar's display preferences.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

interface TaskNavigationState {
  enabled: boolean;
  /** CUSTOM(task-navigation-compact): the phone sidebar's own choice, Tasks list or Workspaces. */
  compactTasks: boolean;
  /** CUSTOM(task-filters-toggle): the arrow beside "Tasks & crews" hides search, sort and filters. */
  filtersCollapsed: boolean;
  setEnabled(enabled: boolean): void;
  setCompactTasks(compactTasks: boolean): void;
  setFiltersCollapsed(filtersCollapsed: boolean): void;
}
export const useTaskNavigationStore = create<TaskNavigationState>()(
  persist(
    (set) => ({
      enabled: false,
      compactTasks: true,
      filtersCollapsed: false,
      setEnabled: (enabled) => set({ enabled }),
      setCompactTasks: (compactTasks) => set({ compactTasks }),
      setFiltersCollapsed: (filtersCollapsed) => set({ filtersCollapsed }),
    }),
    {
      name: "custom-task-navigation",
      version: 1,
      // Optional so a state saved before the phone choice or the filters toggle existed still loads.
      storage: createValidatedPersistStorage(
        AsyncStorage,
        z.object({
          enabled: z.boolean(),
          compactTasks: z.boolean().optional(),
          filtersCollapsed: z.boolean().optional(),
        }),
      ),
      partialize: (state) => ({
        enabled: state.enabled,
        compactTasks: state.compactTasks,
        filtersCollapsed: state.filtersCollapsed,
      }),
    },
  ),
);
