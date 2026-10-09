import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import { toggleFavoriteKey } from "./model";

const FAVORITES_STORAGE_KEY = "custom-model-picker-favorites";

const FavoritesPersistedStateSchema = z.object({ favoriteKeys: z.array(z.string()) });

interface ModelFavoritesState {
  /** `provider:modelId` keys, in the order they were favorited. */
  favoriteKeys: string[];
  toggle(key: string): void;
}

/** Favorites live in this app's storage, so each install (and each launcher profile) has its own. */
export const useModelFavoritesStore = create<ModelFavoritesState>()(
  persist(
    (set) => ({
      favoriteKeys: [],
      toggle: (key) =>
        set((state) => ({ favoriteKeys: toggleFavoriteKey(state.favoriteKeys, key) })),
    }),
    {
      name: FAVORITES_STORAGE_KEY,
      version: 1,
      storage: createValidatedPersistStorage(AsyncStorage, FavoritesPersistedStateSchema),
      partialize: (state) => ({ favoriteKeys: state.favoriteKeys }),
    },
  ),
);
