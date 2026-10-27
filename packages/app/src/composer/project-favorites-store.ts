// CUSTOM(project-favorites): projects starred in the composer's project menu. When any are
// starred, ↑/↓ in an empty draft (← on New Workspace) cycle only through them. Keyed by project
// view key, so the draft tab and the New Workspace screen share the stars.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

interface ProjectFavoritesState {
  keys: string[];
  toggle(key: string): void;
}

export const useProjectFavoritesStore = create<ProjectFavoritesState>()(
  persist(
    (set) => ({
      keys: [],
      toggle: (key) =>
        set((state) => ({
          keys: state.keys.includes(key)
            ? state.keys.filter((x) => x !== key)
            : [...state.keys, key],
        })),
    }),
    {
      name: "custom-project-favorites",
      version: 1,
      storage: createValidatedPersistStorage(AsyncStorage, z.object({ keys: z.array(z.string()) })),
      partialize: (state) => ({ keys: state.keys }),
    },
  ),
);
