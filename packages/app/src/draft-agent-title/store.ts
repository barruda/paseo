// CUSTOM(draft-agent-title): a name given to a New Agent tab before its agent exists. The agent is
// created with it as an explicit title, which the daemon never replaces with a generated one.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

interface DraftAgentTitleState {
  byDraftId: Record<string, string>;
  setTitle(draftId: string, title: string): void;
  clear(draftId: string): void;
}

export const useDraftAgentTitleStore = create<DraftAgentTitleState>()(
  persist(
    (set) => ({
      byDraftId: {},
      setTitle: (draftId, title) =>
        set((state) => {
          const trimmed = title.trim();
          const { [draftId]: _previous, ...rest } = state.byDraftId;
          return { byDraftId: trimmed ? { ...rest, [draftId]: trimmed } : rest };
        }),
      clear: (draftId) =>
        set((state) => {
          if (!(draftId in state.byDraftId)) return state;
          const { [draftId]: _previous, ...rest } = state.byDraftId;
          return { byDraftId: rest };
        }),
    }),
    {
      name: "custom-draft-agent-titles",
      version: 1,
      storage: createValidatedPersistStorage(
        AsyncStorage,
        z.object({ byDraftId: z.record(z.string(), z.string()) }),
      ),
      partialize: (state) => ({ byDraftId: state.byDraftId }),
    },
  ),
);

export function useDraftAgentTitle(draftId: string): string | null {
  return useDraftAgentTitleStore((state) => state.byDraftId[draftId] ?? null);
}

/**
 * The create config with the draft's name as its explicit title. The daemon keeps an explicit title
 * instead of deriving one from the prompt, and the status summary never renames over it.
 */
export function withDraftAgentTitle<T extends object>(draftId: string, config: T): T {
  const title = useDraftAgentTitleStore.getState().byDraftId[draftId];
  return title ? { ...config, title } : config;
}
