// CUSTOM(task-pins): sessions pinned under the Tasks sidebar filters. Local to this app, like the
// rest of the Tasks presentation; the daemon has no session pins.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

interface PinnedTasksState {
  /** Task keys in the order they were pinned. */
  keys: string[];
  togglePin(key: string): void;
}
export const usePinnedTasksStore = create<PinnedTasksState>()(
  persist(
    (set) => ({
      keys: [],
      togglePin: (key) =>
        set((state) => ({
          keys: state.keys.includes(key)
            ? state.keys.filter((k) => k !== key)
            : [...state.keys, key],
        })),
    }),
    {
      name: "custom-task-pins",
      version: 1,
      storage: createValidatedPersistStorage(AsyncStorage, z.object({ keys: z.array(z.string()) })),
      partialize: (state) => ({ keys: state.keys }),
    },
  ),
);
