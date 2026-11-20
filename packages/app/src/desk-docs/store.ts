// CUSTOM(desk-docs): what the Docs tab remembers. Local to this app installation, like the Desks.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import type { DocEntry, DocRoot, DocsSort } from "./model";

interface DeskDocsState {
  docs: DocEntry[];
  roots: DocRoot[];
  sort: DocsSort;
  /** Projects whose section is folded. */
  collapsedProjects: string[];
  /** Projects the filter hides; a project missing here is shown, so new ones start visible. */
  hiddenProjects: string[];
  setDocs(docs: DocEntry[]): void;
  addRoot(root: DocRoot): void;
  removeRoot(id: string): void;
  removeDoc(id: string): void;
  setSort(sort: DocsSort): void;
  toggleProject(projectRef: string): void;
  toggleProjectVisibility(projectRef: string): void;
  showAllProjects(): void;
  hideAllProjects(projectRefs: readonly string[]): void;
}

const docSchema = z.object({
  id: z.string(),
  serverId: z.string(),
  projectRef: z.string(),
  workspaceId: z.string(),
  name: z.string(),
  path: z.string(),
  modifiedAt: z.number(),
});
const rootSchema = z.object({
  id: z.string(),
  serverId: z.string(),
  projectRef: z.string(),
  path: z.string(),
});

export const useDeskDocsStore = create<DeskDocsState>()(
  persist(
    (set) => ({
      docs: [],
      roots: [],
      sort: "recent",
      collapsedProjects: [],
      hiddenProjects: [],
      setDocs: (docs) => set({ docs }),
      addRoot: (root) =>
        set((state) =>
          state.roots.some(
            (entry) =>
              entry.serverId === root.serverId &&
              entry.projectRef === root.projectRef &&
              entry.path === root.path,
          )
            ? state
            : { roots: [...state.roots, root] },
        ),
      removeRoot: (id) => set((state) => ({ roots: state.roots.filter((root) => root.id !== id) })),
      removeDoc: (id) => set((state) => ({ docs: state.docs.filter((doc) => doc.id !== id) })),
      setSort: (sort) => set({ sort }),
      toggleProject: (projectRef) =>
        set((state) => ({
          collapsedProjects: state.collapsedProjects.includes(projectRef)
            ? state.collapsedProjects.filter((ref) => ref !== projectRef)
            : [...state.collapsedProjects, projectRef],
        })),
      toggleProjectVisibility: (projectRef) =>
        set((state) => ({
          hiddenProjects: state.hiddenProjects.includes(projectRef)
            ? state.hiddenProjects.filter((ref) => ref !== projectRef)
            : [...state.hiddenProjects, projectRef],
        })),
      showAllProjects: () => set({ hiddenProjects: [] }),
      hideAllProjects: (projectRefs) => set({ hiddenProjects: [...projectRefs] }),
    }),
    {
      name: "custom-desk-docs",
      version: 1,
      storage: createValidatedPersistStorage(
        AsyncStorage,
        z.object({
          docs: z.array(docSchema),
          roots: z.array(rootSchema),
          sort: z.enum(["recent", "name"]),
          collapsedProjects: z.array(z.string()),
          // Optional so a state saved before the filter existed still loads.
          hiddenProjects: z.array(z.string()).optional(),
        }),
      ),
      partialize: (state) => ({
        docs: state.docs,
        roots: state.roots,
        sort: state.sort,
        collapsedProjects: state.collapsedProjects,
        hiddenProjects: state.hiddenProjects,
      }),
    },
  ),
);
