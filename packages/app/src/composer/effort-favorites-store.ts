// CUSTOM(effort-favorites): effort levels starred in the effort menu, per model. When the current
// model has starred levels, → in the composer and a click on the effort chip cycle only through
// them; with none starred they cycle every level the model offers. Keyed by
// `${provider}:${modelId}` (the model favorites' key), so Haiku and Opus keep their own stars.
// Version 1 kept one global list of effort ids; it is dropped, since it can't be split per model.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

interface EffortFavoritesState {
  byModel: Record<string, string[]>;
  toggle(modelKey: string, effortId: string): void;
}

const NO_FAVORITES: readonly string[] = [];

export function effortFavoriteKey(
  provider: string | null | undefined,
  modelId: string | null | undefined,
): string | null {
  return provider && modelId ? `${provider}:${modelId}` : null;
}

export function toggleEffortFavorite(
  byModel: Readonly<Record<string, string[]>>,
  modelKey: string,
  effortId: string,
): Record<string, string[]> {
  const current = byModel[modelKey] ?? [];
  const next = current.includes(effortId)
    ? current.filter((id) => id !== effortId)
    : [...current, effortId];
  const result = { ...byModel };
  if (next.length) result[modelKey] = next;
  else delete result[modelKey];
  return result;
}

export const useEffortFavoritesStore = create<EffortFavoritesState>()(
  persist(
    (set) => ({
      byModel: {},
      toggle: (modelKey, effortId) =>
        set((state) => ({ byModel: toggleEffortFavorite(state.byModel, modelKey, effortId) })),
    }),
    {
      name: "custom-effort-favorites",
      version: 2,
      migrate: () => ({ byModel: {} }),
      storage: createValidatedPersistStorage(
        AsyncStorage,
        z.object({ byModel: z.record(z.string(), z.array(z.string())) }),
      ),
      partialize: (state) => ({ byModel: state.byModel }),
    },
  ),
);

/** The starred effort ids of one model, read synchronously for the key and chip handlers. */
export function getEffortFavorites(
  provider: string | null | undefined,
  modelId: string | null | undefined,
): readonly string[] {
  const key = effortFavoriteKey(provider, modelId);
  return key ? (useEffortFavoritesStore.getState().byModel[key] ?? NO_FAVORITES) : NO_FAVORITES;
}
