import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import { DEFAULT_SIDEBAR_WORKSPACE_LIMIT, type SidebarWorkspaceLimit } from "./model";

const STORAGE_KEY = "custom-sidebar-workspace-limit";

const PersistedSchema = z.object({
  showRecent: z.boolean(),
  maxPerProject: z.number().int().positive().nullable(),
  maxAgeHours: z.number().positive().nullable(),
});

interface SidebarWorkspaceLimitState extends SidebarWorkspaceLimit {
  showRecent: boolean;
  /** Projects opened with Show more. Not persisted: a restart starts trimmed again. */
  expandedProjectKeys: ReadonlySet<string>;
  toggleShowRecent(): void;
  setMaxPerProject(value: number | null): void;
  setMaxAgeHours(value: number | null): void;
  toggleProjectExpanded(viewKey: string): void;
}

/** Lives in this app's storage, like the other display preferences that are not synced. */
export const useSidebarWorkspaceLimitStore = create<SidebarWorkspaceLimitState>()(
  persist(
    (set) => ({
      showRecent: true,
      ...DEFAULT_SIDEBAR_WORKSPACE_LIMIT,
      expandedProjectKeys: new Set<string>(),
      toggleShowRecent: () => set((state) => ({ showRecent: !state.showRecent })),
      setMaxPerProject: (maxPerProject) => set({ maxPerProject }),
      setMaxAgeHours: (maxAgeHours) => set({ maxAgeHours }),
      toggleProjectExpanded: (viewKey) =>
        set((state) => {
          const next = new Set(state.expandedProjectKeys);
          if (!next.delete(viewKey)) next.add(viewKey);
          return { expandedProjectKeys: next };
        }),
    }),
    {
      name: STORAGE_KEY,
      version: 1,
      storage: createValidatedPersistStorage(AsyncStorage, PersistedSchema),
      partialize: (state) => ({
        showRecent: state.showRecent,
        maxPerProject: state.maxPerProject,
        maxAgeHours: state.maxAgeHours,
      }),
    },
  ),
);
