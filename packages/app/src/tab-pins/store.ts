// CUSTOM(tab-pins): which tabs are pinned, per tab row owner (a workspace or a Desk). Local to this
// app; the daemon knows nothing about tab pins.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

interface TabPinsState {
  /** Pinned tab ids by scope (the split layout's workspace key, `desk:<id>` for a Desk). */
  byScope: Record<string, string[]>;
  setPinned(scope: string, tabId: string, pinned: boolean): void;
}

export const useTabPinsStore = create<TabPinsState>()(
  persist(
    (set) => ({
      byScope: {},
      setPinned: (scope, tabId, pinned) =>
        set((state) => {
          const current = state.byScope[scope] ?? [];
          const next = current.filter((id) => id !== tabId);
          if (pinned) next.push(tabId);
          const { [scope]: _previous, ...rest } = state.byScope;
          return { byScope: next.length > 0 ? { ...rest, [scope]: next } : rest };
        }),
    }),
    {
      name: "custom-tab-pins",
      version: 1,
      storage: createValidatedPersistStorage(
        AsyncStorage,
        z.object({ byScope: z.record(z.string(), z.array(z.string())) }),
      ),
      partialize: (state) => ({ byScope: state.byScope }),
    },
  ),
);
