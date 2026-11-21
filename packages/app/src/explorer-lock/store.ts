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
}

export const useExplorerLockStore = create<ExplorerLockState>()(
  persist(
    (set) => ({
      open: false,
      setOpen: (open) => set((state) => (state.open === open ? state : { open })),
    }),
    {
      name: "custom-explorer-lock",
      version: 1,
      storage: createValidatedPersistStorage(AsyncStorage, z.object({ open: z.boolean() })),
      partialize: (state) => ({ open: state.open }),
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
