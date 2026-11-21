// CUSTOM(explorer-lock): the right sidebar's locked open/closed state, shared by every view and
// kept across reloads. Only used while "Keep the right sidebar open or closed" is on.
import { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { z } from "zod";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

interface ExplorerLockState {
  open: boolean;
  setOpen(open: boolean): void;
  /** The locked sidebar width shared by every Explorer frame; null until one is known. */
  width: number | null;
  setWidth(width: number): void;
}

export const useExplorerLockStore = create<ExplorerLockState>()(
  persist(
    (set) => ({
      open: false,
      setOpen: (open) => set((state) => (state.open === open ? state : { open })),
      width: null,
      setWidth: (width) =>
        set((state) =>
          !Number.isFinite(width) || width <= 0 || state.width === width ? state : { width },
        ),
    }),
    {
      name: "custom-explorer-lock",
      version: 1,
      storage: createValidatedPersistStorage(
        AsyncStorage,
        z.object({ open: z.boolean(), width: z.number().nullable().optional() }),
      ),
      partialize: (state) => ({ open: state.open, width: state.width }),
      // Saved data from before the width was locked has none.
      merge: (persisted, current) => {
        const saved = (persisted ?? {}) as Partial<{ open: boolean; width: number | null }>;
        return { ...current, ...saved, width: saved.width ?? null };
      },
    },
  ),
);

/** Until the saved state loads, the lock must not apply its default (closed). */
export function useExplorerLockHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => useExplorerLockStore.persist.hasHydrated());
  useEffect(() => {
    if (hydrated) return;
    if (useExplorerLockStore.persist.hasHydrated()) setHydrated(true);
    return useExplorerLockStore.persist.onFinishHydration(() => setHydrated(true));
  }, [hydrated]);
  return hydrated;
}
