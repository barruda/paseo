// CUSTOM(changes-diff-tab): "Open in different tabs" on the Changes tree. Off by default, so a
// file click retargets the diff tab that is already open instead of opening another one.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

interface DiffTabsState {
  openInNewTabs: boolean;
  toggleOpenInNewTabs(): void;
}

export const useDiffTabsStore = create<DiffTabsState>()(
  persist(
    (set) => ({
      openInNewTabs: false,
      toggleOpenInNewTabs: () => set((state) => ({ openInNewTabs: !state.openInNewTabs })),
    }),
    {
      name: "custom-changes-diff-tabs",
      version: 1,
      storage: createValidatedPersistStorage(
        AsyncStorage,
        z.object({ openInNewTabs: z.boolean() }),
      ),
      partialize: (state) => ({ openInNewTabs: state.openInNewTabs }),
    },
  ),
);
