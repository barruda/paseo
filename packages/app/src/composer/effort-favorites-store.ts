// CUSTOM(effort-favorites): effort levels starred in the effort menu. When any are starred,
// → in an empty composer cycles only through them. Keyed by effort id ("high", "max"), so a star
// applies to every provider that offers that level.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

interface EffortFavoritesState {
  ids: string[];
  toggle(id: string): void;
}

export const useEffortFavoritesStore = create<EffortFavoritesState>()(
  persist(
    (set) => ({
      ids: [],
      toggle: (id) =>
        set((state) => ({
          ids: state.ids.includes(id) ? state.ids.filter((x) => x !== id) : [...state.ids, id],
        })),
    }),
    {
      name: "custom-effort-favorites",
      version: 1,
      storage: createValidatedPersistStorage(AsyncStorage, z.object({ ids: z.array(z.string()) })),
      partialize: (state) => ({ ids: state.ids }),
    },
  ),
);
