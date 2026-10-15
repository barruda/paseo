// CUSTOM(task-navigation): opt in without changing the existing sidebar's display preferences.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

interface TaskNavigationState {
  enabled: boolean;
  setEnabled(enabled: boolean): void;
}
export const useTaskNavigationStore = create<TaskNavigationState>()(
  persist((set) => ({ enabled: false, setEnabled: (enabled) => set({ enabled }) }), {
    name: "custom-task-navigation",
    version: 1,
    storage: createValidatedPersistStorage(AsyncStorage, z.object({ enabled: z.boolean() })),
    partialize: (state) => ({ enabled: state.enabled }),
  }),
);
