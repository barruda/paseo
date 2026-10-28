import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

// CUSTOM(cache-warmup): the composer toggle. Pings are on by default, so only sessions turned off
// are stored, keyed by `cacheWarmupAgentKey`.

const CacheWarmupPersistedStateSchema = z.object({
  disabledAgentKeys: z.array(z.string()),
});

interface CacheWarmupStoreState {
  disabledAgentKeys: string[];
  setEnabled: (agentKey: string, enabled: boolean) => void;
}

export const useCacheWarmupStore = create<CacheWarmupStoreState>()(
  persist(
    (set) => ({
      disabledAgentKeys: [],
      setEnabled: (agentKey, enabled) => {
        set((state) => {
          const rest = state.disabledAgentKeys.filter((key) => key !== agentKey);
          return { disabledAgentKeys: enabled ? rest : [...rest, agentKey] };
        });
      },
    }),
    {
      name: "cache-warmup",
      storage: createValidatedPersistStorage(AsyncStorage, CacheWarmupPersistedStateSchema),
      partialize: (state) => ({ disabledAgentKeys: state.disabledAgentKeys }),
      version: 1,
    },
  ),
);
