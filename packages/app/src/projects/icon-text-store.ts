// CUSTOM(project-icon-text): text typed into a project's generated icon in Edit project, shown
// instead of its initial. Keyed by project view key, the same key that picks the icon's color.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

interface ProjectIconTextState {
  texts: Record<string, string>;
  /** Empty text goes back to the initial. */
  setText(viewKey: string, text: string): void;
}

export const useProjectIconTextStore = create<ProjectIconTextState>()(
  persist(
    (set) => ({
      texts: {},
      setText: (viewKey, text) =>
        set((state) => {
          const { [viewKey]: _previous, ...rest } = state.texts;
          const trimmed = text.trim();
          return { texts: trimmed ? { ...rest, [viewKey]: trimmed } : rest };
        }),
    }),
    {
      name: "custom-project-icon-text",
      version: 1,
      storage: createValidatedPersistStorage(
        AsyncStorage,
        z.object({ texts: z.record(z.string(), z.string()) }),
      ),
      partialize: (state) => ({ texts: state.texts }),
    },
  ),
);
