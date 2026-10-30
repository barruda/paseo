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
  setEnabled(enabled: boolean): void;
  setCompactTasks(compactTasks: boolean): void;
}
export const useTaskNavigationStore = create<TaskNavigationState>()(
  persist(
    (set) => ({
      enabled: false,
      compactTasks: true,
      setEnabled: (enabled) => set({ enabled }),
      setCompactTasks: (compactTasks) => set({ compactTasks }),
    }),
    {
      name: "custom-task-navigation",
      version: 1,
      // Optional so a state saved before the phone choice existed still loads.
      storage: createValidatedPersistStorage(
        AsyncStorage,
        z.object({ enabled: z.boolean(), compactTasks: z.boolean().optional() }),
      ),
      partialize: (state) => ({ enabled: state.enabled, compactTasks: state.compactTasks }),
    },
  ),
);
