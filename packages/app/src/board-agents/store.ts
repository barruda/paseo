// CUSTOM(hidden-board-agents): the Tasks sidebar hides board agents unless this toggle is on.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

interface BoardAgentsState {
  showBoardAgents: boolean;
  setShowBoardAgents(value: boolean): void;
}

export const useBoardAgentsStore = create<BoardAgentsState>()(
  persist(
    (set) => ({
      showBoardAgents: false,
      setShowBoardAgents: (showBoardAgents) => set({ showBoardAgents }),
    }),
    {
      name: "paseo-board-agents",
      version: 1,
      storage: createValidatedPersistStorage(
        AsyncStorage,
        z.object({ showBoardAgents: z.boolean() }),
      ),
      partialize: (state) => ({ showBoardAgents: state.showBoardAgents }),
    },
  ),
);
