// CUSTOM(desks): presentation references only; workspace/session ownership stays on the daemon.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import type { JsonValue } from "@getpaseo/protocol/agent-types";
import type { WorkspaceTabTarget } from "@/workspace-tabs/model";
import { workspaceTabTargetsEqual } from "@/workspace-tabs/identity";
import { WorkspaceTabTargetStorageSchema } from "@/stores/workspace-layout-storage";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";

export interface DeskTab {
  id: string;
  serverId: string;
  workspaceId: string;
  target: WorkspaceTabTarget;
  state?: JsonValue;
}
export type DeskTabInput = Omit<DeskTab, "id">;
export interface Desk {
  id: string;
  name: string;
  tabs: DeskTab[];
  preview: DeskTab | null;
  activeTabId: string | null;
}
export type TaskSort = "attention" | "activity" | "opened" | "title";
interface DesksState {
  desks: Desk[];
  activeDeskId: string;
  initialized: boolean;
  projectKeys: string[] | null;
  sort: TaskSort;
  openedAt: Record<string, number>;
  initialize(tab?: DeskTabInput): void;
  createDesk(name: string): void;
  renameDesk(name: string): void;
  selectDesk(id: string): void;
  openTab(tab: DeskTabInput, pin?: boolean): void;
  selectTab(id: string): void;
  closeTab(id: string): void;
  keepPreview(): void;
  updateTab(id: string, patch: Partial<Pick<DeskTab, "target" | "state">>): void;
  setProjects(keys: string[] | null): void;
  setSort(sort: TaskSort): void;
}
const tabSchema: z.ZodType<DeskTab> = z.object({
  id: z.string(),
  serverId: z.string(),
  workspaceId: z.string(),
  target: WorkspaceTabTargetStorageSchema,
  state: z.json().optional(),
});
const schema = z.object({
  desks: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        tabs: z.array(tabSchema),
        preview: tabSchema.nullable(),
        activeTabId: z.string().nullable(),
      }),
    )
    .min(1),
  activeDeskId: z.string(),
  initialized: z.boolean(),
  projectKeys: z.array(z.string()).nullable(),
  sort: z.enum(["attention", "activity", "opened", "title"]),
  openedAt: z.record(z.string(), z.number()),
});
const newId = () => `desk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
export const initialDesks = () => [
  {
    id: "primary",
    name: "Primary tasks",
    tabs: [],
    preview: null,
    activeTabId: null,
  } satisfies Desk,
];
export function sameDeskTarget(a: DeskTabInput, b: DeskTabInput) {
  return (
    a.serverId === b.serverId &&
    a.workspaceId === b.workspaceId &&
    workspaceTabTargetsEqual(a.target, b.target)
  );
}
export function activeDesk(state: Pick<DesksState, "desks" | "activeDeskId">): Desk {
  return state.desks.find((desk) => desk.id === state.activeDeskId) ?? state.desks[0]!;
}
export function activeDeskTab(state: Pick<DesksState, "desks" | "activeDeskId">): DeskTab | null {
  const desk = activeDesk(state);
  return [desk.preview, ...desk.tabs].find((tab) => tab?.id === desk.activeTabId) ?? null;
}
function patchDeskTab(
  desk: Desk,
  id: string,
  patch: Partial<Pick<DeskTab, "target" | "state">>,
): Desk {
  if (desk.preview?.id !== id && !desk.tabs.some((tab) => tab.id === id)) return desk;
  return {
    ...desk,
    preview: desk.preview?.id === id ? { ...desk.preview, ...patch } : desk.preview,
    tabs: desk.tabs.map((tab) => (tab.id === id ? { ...tab, ...patch } : tab)),
  };
}
export const useDesksStore = create<DesksState>()(
  persist(
    (set, get) => {
      const change = (update: (desk: Desk) => Desk) =>
        set((state) => {
          const current = activeDesk(state);
          return {
            desks: state.desks.map((desk) => (desk.id === current.id ? update(desk) : desk)),
          };
        });
      return {
        desks: initialDesks(),
        activeDeskId: "primary",
        initialized: false,
        projectKeys: null,
        sort: "attention",
        openedAt: {},
        initialize: (tab) => {
          if (get().initialized) return;
          set({ initialized: true });
          if (tab) get().openTab(tab);
        },
        createDesk: (name) => {
          if (!name.trim()) return;
          const desk: Desk = {
            id: newId(),
            name: name.trim(),
            tabs: [],
            preview: null,
            activeTabId: null,
          };
          set((state) => ({ desks: [...state.desks, desk], activeDeskId: desk.id }));
        },
        renameDesk: (name) => {
          if (name.trim()) change((desk) => ({ ...desk, name: name.trim() }));
        },
        selectDesk: (id) => {
          if (get().desks.some((d) => d.id === id)) set({ activeDeskId: id });
        },
        openTab: (input, pin = false) => {
          if (!get().initialized) set({ initialized: true });
          if (input.target.kind === "agent") {
            const key = `${input.serverId}:${input.target.agentId}`;
            set((state) => ({ openedAt: { ...state.openedAt, [key]: Date.now() } }));
          }
          change((desk) => {
            const existing = desk.tabs.find((tab) => sameDeskTarget(tab, input));
            if (existing) return { ...desk, activeTabId: existing.id };
            const tab =
              desk.preview && sameDeskTarget(desk.preview, input)
                ? desk.preview
                : { ...input, id: newId() };
            return pin
              ? {
                  ...desk,
                  tabs: [...desk.tabs, tab],
                  preview: desk.preview?.id === tab.id ? null : desk.preview,
                  activeTabId: tab.id,
                }
              : { ...desk, preview: tab, activeTabId: tab.id };
          });
        },
        selectTab: (id) =>
          change((desk) =>
            [desk.preview, ...desk.tabs].some((t) => t?.id === id)
              ? { ...desk, activeTabId: id }
              : desk,
          ),
        closeTab: (id) =>
          change((desk) => {
            const tabs = desk.tabs.filter((tab) => tab.id !== id);
            const preview = desk.preview?.id === id ? null : desk.preview;
            return {
              ...desk,
              tabs,
              preview,
              activeTabId:
                desk.activeTabId === id
                  ? (preview?.id ?? tabs.at(-1)?.id ?? null)
                  : desk.activeTabId,
            };
          }),
        keepPreview: () => {
          const preview = activeDesk(get()).preview;
          if (preview) get().openTab(preview, true);
        },
        updateTab: (id, patch) =>
          set((state) => ({ desks: state.desks.map((desk) => patchDeskTab(desk, id, patch)) })),
        setProjects: (projectKeys) => set({ projectKeys }),
        setSort: (sort) => set({ sort }),
      };
    },
    {
      name: "custom-desks",
      version: 1,
      storage: createValidatedPersistStorage(AsyncStorage, schema),
      partialize: ({ desks, activeDeskId, initialized, projectKeys, sort, openedAt }) => ({
        desks,
        activeDeskId,
        initialized,
        projectKeys,
        sort,
        openedAt,
      }),
    },
  ),
);
