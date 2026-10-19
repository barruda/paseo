// CUSTOM(desks): presentation references only; workspace/session ownership stays on the daemon.
// A Desk is a workspace-style split layout plus the workspace each of its tabs belongs to, so the
// standard SplitContainer renders it and every layout rule is shared with workspaces.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import type { JsonValue } from "@getpaseo/protocol/agent-types";
import type { WorkspaceTab, WorkspaceTabTarget } from "@/workspace-tabs/model";
import { workspaceTabTargetsEqual } from "@/workspace-tabs/identity";
import {
  WorkspaceLayoutStorageSchema,
  WorkspaceTabTargetStorageSchema,
} from "@/stores/workspace-layout-storage";
import {
  closeTabInLayout,
  collectAllTabs,
  createDefaultLayout,
  createTabInLayout,
  DEFAULT_PANE_ID,
  FOCUSED_PANE_PLACEMENT,
  findPaneById,
  findPaneContainingTab,
  focusPaneInLayout,
  focusTabInLayout,
  moveTabToPaneInLayout,
  normalizeLayout,
  reorderPaneTabsInLayout,
  replaceTabTargetInLayout,
  resizeSplitInLayout,
  selectTabInPaneInLayout,
  setTabStateInLayout,
  splitPaneEmptyInLayout,
  splitPaneInLayout,
  type WorkspaceLayout,
  type WorkspaceTabPlacement,
} from "@/stores/workspace-layout-actions";
import { defaultWorkspaceLayoutIds } from "@/stores/workspace-layout-ids";
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import {
  toggleBottomPanelInLayout,
  type BottomPanelToggleResult,
} from "@/workspace-tabs/bottom-panel";

export interface DeskTabOwner {
  serverId: string;
  workspaceId: string;
}
export interface DeskTab extends DeskTabOwner {
  id: string;
  target: WorkspaceTabTarget;
  state?: JsonValue;
}
export type DeskTabInput = Omit<DeskTab, "id">;
export interface Desk {
  id: string;
  name: string;
  layout: WorkspaceLayout;
  /** Tabs without an owner (a fresh new-tab launcher) use the screen's current scope. */
  owners: Record<string, DeskTabOwner>;
  previewTabId: string | null;
  /** CUSTOM(desk-explorer): tabs that show their workspace's Explorer beside them. */
  explorerTabIds?: string[];
}
export type DeskTabPatch = Partial<Pick<DeskTab, "target" | "state" | "serverId" | "workspaceId">>;
export type DeskSplitPosition = "left" | "right" | "top" | "bottom";
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
  renameDesk(id: string, name: string): void;
  /** Drops a Desk; its tabs are only references, so the agents and workspaces stay. Keeps one Desk. */
  deleteDesk(id: string): void;
  selectDesk(id: string): void;
  /** Unpinned opens replace the Desk's preview tab; pinned opens keep their tab. */
  openTab(tab: DeskTabInput, pin?: boolean, placement?: WorkspaceTabPlacement): void;
  selectTab(id: string): void;
  closeTab(id: string): void;
  /** Moves a tab of the active Desk into another Desk as a kept tab, leaving that Desk unselected. */
  moveTabToDesk(id: string, deskId: string): void;
  keepPreview(): void;
  /** serverId with workspaceId gives an unowned tab (a new-tab launcher) its workspace. */
  updateTab(id: string, patch: DeskTabPatch): void;
  createNewTab(owner: DeskTabOwner | null, paneId?: string): void;
  splitPane(input: { tabId: string; targetPaneId: string; position: DeskSplitPosition }): void;
  splitPaneEmpty(
    input: { targetPaneId: string; position: DeskSplitPosition },
    owner: DeskTabOwner | null,
  ): void;
  moveTabToPane(tabId: string, toPaneId: string): void;
  focusPane(paneId: string): void;
  selectTabInPane(paneId: string, tabId: string): void;
  resizeSplit(groupId: string, sizes: number[]): void;
  reorderTabsInPane(paneId: string, tabIds: string[]): void;
  setTabExplorerOpen(tabId: string, open: boolean): void;
  /**
   * CUSTOM(desk-bottom-panel): the workspace bottom panel, as a pane of the Desk layout. A new
   * panel's launcher tab belongs to `owner`.
   */
  toggleBottomPanel(owner: DeskTabOwner): BottomPanelToggleResult | null;
  setProjects(keys: string[] | null): void;
  setSort(sort: TaskSort): void;
}

const MAX_TREE_DEPTH = 5;
const ownerSchema = z.object({ serverId: z.string(), workspaceId: z.string() });
const deskSchema = z.object({
  id: z.string(),
  name: z.string(),
  layout: WorkspaceLayoutStorageSchema,
  owners: z.record(z.string(), ownerSchema),
  previewTabId: z.string().nullable(),
  explorerTabIds: z.array(z.string()).optional(),
});
// COMPAT(desk-layouts): Desks before split panes kept a flat tab list; migrated on load.
const legacyTabSchema = z.object({
  id: z.string(),
  serverId: z.string(),
  workspaceId: z.string(),
  target: WorkspaceTabTargetStorageSchema,
  state: z.json().optional(),
});
const legacyDeskSchema = z.object({
  id: z.string(),
  name: z.string(),
  tabs: z.array(legacyTabSchema),
  preview: legacyTabSchema.nullable(),
  activeTabId: z.string().nullable(),
});
type LegacyDesk = z.infer<typeof legacyDeskSchema>;
const schema = z.object({
  desks: z.array(z.union([deskSchema, legacyDeskSchema])).min(1),
  activeDeskId: z.string(),
  initialized: z.boolean(),
  projectKeys: z.array(z.string()).nullable(),
  sort: z.enum(["attention", "activity", "opened", "title"]),
  openedAt: z.record(z.string(), z.number()),
});
type PersistedDesks = z.infer<typeof schema>;

const newId = () => `desk-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
const createNodeId = defaultWorkspaceLayoutIds.createNodeId;
function createDesk(id: string, name: string): Desk {
  return { id, name, layout: createDefaultLayout(), owners: {}, previewTabId: null };
}
export const initialDesks = (): Desk[] => [createDesk("primary", "Primary tasks")];

function migrateLegacyDesk(desk: LegacyDesk | Desk): Desk {
  if ("layout" in desk) return { ...desk, layout: normalizeLayout(desk.layout) };
  const tabs = [...(desk.preview ? [desk.preview] : []), ...desk.tabs];
  if (tabs.length === 0) return createDesk(desk.id, desk.name);
  const createdAt = Date.now();
  const layoutTabs: WorkspaceTab[] = tabs.map((tab) => ({
    tabId: tab.id,
    target: tab.target,
    createdAt,
    ...(tab.state !== undefined ? { state: tab.state } : {}),
  }));
  const tabIds = layoutTabs.map((tab) => tab.tabId);
  const focusedTabId =
    desk.activeTabId && tabIds.includes(desk.activeTabId) ? desk.activeTabId : tabIds[0]!;
  return {
    id: desk.id,
    name: desk.name,
    layout: normalizeLayout({
      root: {
        kind: "pane",
        pane: { id: DEFAULT_PANE_ID, tabIds, focusedTabId, tabs: layoutTabs },
      },
      focusedPaneId: DEFAULT_PANE_ID,
    }),
    owners: Object.fromEntries(
      tabs.map((tab) => [tab.id, { serverId: tab.serverId, workspaceId: tab.workspaceId }]),
    ),
    previewTabId: desk.preview?.id ?? null,
  };
}

export function sameDeskTarget(a: DeskTabInput, b: DeskTabInput) {
  return (
    a.serverId === b.serverId &&
    a.workspaceId === b.workspaceId &&
    workspaceTabTargetsEqual(a.target, b.target)
  );
}

const tabsByDesk = new WeakMap<Desk, DeskTab[]>();
/** The Desk's owned tabs in layout order; cached per Desk value so selectors stay stable. */
export function deskTabs(desk: Desk): DeskTab[] {
  const cached = tabsByDesk.get(desk);
  if (cached) return cached;
  const tabs = collectAllTabs(desk.layout.root).flatMap((tab) => {
    const owner = desk.owners[tab.tabId];
    if (!owner) return [];
    return [
      {
        id: tab.tabId,
        serverId: owner.serverId,
        workspaceId: owner.workspaceId,
        target: tab.target,
        ...(tab.state !== undefined ? { state: tab.state } : {}),
      },
    ];
  });
  tabsByDesk.set(desk, tabs);
  return tabs;
}
export function activeDesk(state: Pick<DesksState, "desks" | "activeDeskId">): Desk {
  return state.desks.find((desk) => desk.id === state.activeDeskId) ?? state.desks[0]!;
}
/** The focused pane's selected tab. */
export function activeDeskTab(state: Pick<DesksState, "desks" | "activeDeskId">): DeskTab | null {
  const desk = activeDesk(state);
  const tabId = findPaneById(desk.layout.root, desk.layout.focusedPaneId)?.focusedTabId;
  return tabId ? (deskTabs(desk).find((tab) => tab.id === tabId) ?? null) : null;
}

// Keeping the owners object stable spares every tab chip and panel a re-render on focus changes.
function sameOwners(a: Record<string, DeskTabOwner>, b: Record<string, DeskTabOwner>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => a[key] === b[key]);
}

/** Applies a layout change, keeping owners and the preview in step with the tabs that remain. */
function withLayout(
  desk: Desk,
  layout: WorkspaceLayout | null,
  owners: Record<string, DeskTabOwner> = desk.owners,
  fallback: DeskTabOwner | null = null,
): Desk {
  if (!layout) return desk;
  const nextOwners: Record<string, DeskTabOwner> = {};
  const tabIds = new Set<string>();
  for (const tab of collectAllTabs(layout.root)) {
    tabIds.add(tab.tabId);
    const owner = owners[tab.tabId] ?? fallback;
    if (owner) nextOwners[tab.tabId] = owner;
  }
  const previewTabId =
    desk.previewTabId && findPaneContainingTab(layout.root, desk.previewTabId)
      ? desk.previewTabId
      : null;
  const explorerTabIds = desk.explorerTabIds?.filter((tabId) => tabIds.has(tabId));
  return {
    ...desk,
    layout,
    owners: sameOwners(desk.owners, nextOwners) ? desk.owners : nextOwners,
    previewTabId,
    explorerTabIds:
      explorerTabIds?.length === desk.explorerTabIds?.length ? desk.explorerTabIds : explorerTabIds,
  };
}

/** A retargeted tab can get a new id; its Explorer stays open under that id. */
function renameExplorerTab(desk: Desk, from: string, to: string): Desk {
  if (from === to || !desk.explorerTabIds?.includes(from)) return desk;
  return { ...desk, explorerTabIds: desk.explorerTabIds.map((id) => (id === from ? to : id)) };
}

function openInDesk(
  desk: Desk,
  input: DeskTabInput,
  pin: boolean,
  placement: WorkspaceTabPlacement,
): Desk {
  const existing = deskTabs(desk).find((tab) => sameDeskTarget(tab, input));
  if (existing) {
    const layout = focusTabInLayout({ layout: desk.layout, tabId: existing.id }) ?? desk.layout;
    return {
      ...desk,
      layout,
      previewTabId: pin && desk.previewTabId === existing.id ? null : desk.previewTabId,
    };
  }
  const owner = { serverId: input.serverId, workspaceId: input.workspaceId };
  if (!pin && desk.previewTabId && findPaneContainingTab(desk.layout.root, desk.previewTabId)) {
    // The content key includes the owner, so a preview reused across workspaces still remounts.
    const replaced = replaceTabTargetInLayout({
      layout: desk.layout,
      tabId: desk.previewTabId,
      target: input.target,
      state: input.state,
      createTabId: newId,
    });
    if (replaced) {
      const layout =
        focusTabInLayout({ layout: replaced.layout, tabId: replaced.tabId }) ?? replaced.layout;
      return {
        ...withLayout(renameExplorerTab(desk, desk.previewTabId, replaced.tabId), layout, {
          ...desk.owners,
          [replaced.tabId]: owner,
        }),
        previewTabId: replaced.tabId,
      };
    }
  }
  const created = createTabInLayout({
    layout: desk.layout,
    target: input.target,
    state: input.state,
    now: Date.now(),
    placement,
    explorerSidebarPaneId: null,
    createTabId: newId,
  });
  if (!created) return desk;
  const next = withLayout(desk, created.layout, { ...desk.owners, [created.tabId]: owner }, owner);
  return pin ? next : { ...next, previewTabId: created.tabId };
}

function patchOwner(owner: DeskTabOwner | undefined, patch: DeskTabPatch): DeskTabOwner | null {
  const serverId = patch.serverId ?? owner?.serverId;
  const workspaceId = patch.workspaceId ?? owner?.workspaceId;
  return serverId && workspaceId ? { serverId, workspaceId } : null;
}

function updateDeskTab(desk: Desk, id: string, patch: DeskTabPatch): Desk {
  if (!findPaneContainingTab(desk.layout.root, id)) return desk;
  let next = desk;
  let tabId = id;
  const patchedOwner = patchOwner(next.owners[tabId], patch);
  if (patchedOwner) next = { ...next, owners: { ...next.owners, [tabId]: patchedOwner } };
  if (patch.target) {
    const replaced = replaceTabTargetInLayout({
      layout: next.layout,
      tabId,
      target: patch.target,
      createTabId: newId,
    });
    if (replaced) {
      const owner = next.owners[tabId];
      const owners = owner ? { ...next.owners, [replaced.tabId]: owner } : next.owners;
      const previewTabId = next.previewTabId === tabId ? replaced.tabId : next.previewTabId;
      next = withLayout(
        { ...renameExplorerTab(next, tabId, replaced.tabId), previewTabId },
        replaced.layout,
        owners,
      );
      tabId = replaced.tabId;
    }
  }
  if ("state" in patch) {
    next = withLayout(
      next,
      setTabStateInLayout({ layout: next.layout, tabId, state: patch.state }),
    );
  }
  return next;
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
      const changeLayout = (
        update: (layout: WorkspaceLayout) => WorkspaceLayout | null,
        fallback: DeskTabOwner | null = null,
      ) => change((desk) => withLayout(desk, update(desk.layout), desk.owners, fallback));
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
          const desk = createDesk(newId(), name.trim());
          set((state) => ({ desks: [...state.desks, desk], activeDeskId: desk.id }));
        },
        renameDesk: (id, name) => {
          if (!name.trim()) return;
          set((state) => ({
            desks: state.desks.map((desk) =>
              desk.id === id ? { ...desk, name: name.trim() } : desk,
            ),
          }));
        },
        deleteDesk: (id) =>
          set((state) => {
            const index = state.desks.findIndex((desk) => desk.id === id);
            if (index < 0 || state.desks.length <= 1) return {};
            const desks = state.desks.filter((desk) => desk.id !== id);
            const activeDeskId =
              state.activeDeskId === id ? desks[Math.max(0, index - 1)]!.id : state.activeDeskId;
            return { desks, activeDeskId };
          }),
        selectDesk: (id) => {
          if (get().desks.some((d) => d.id === id)) set({ activeDeskId: id });
        },
        openTab: (input, pin = false, placement = FOCUSED_PANE_PLACEMENT) => {
          if (!get().initialized) set({ initialized: true });
          if (input.target.kind === "agent") {
            const key = `${input.serverId}:${input.target.agentId}`;
            set((state) => ({ openedAt: { ...state.openedAt, [key]: Date.now() } }));
          }
          change((desk) => openInDesk(desk, input, pin, placement));
        },
        selectTab: (id) =>
          change((desk) => withLayout(desk, focusTabInLayout({ layout: desk.layout, tabId: id }))),
        closeTab: (id) =>
          set((state) => ({
            desks: state.desks.map((desk) =>
              withLayout(
                desk,
                closeTabInLayout({ layout: desk.layout, tabId: id, explorerSidebarPaneId: null }),
              ),
            ),
          })),
        moveTabToDesk: (id, deskId) =>
          set((state) => {
            const source = activeDesk(state);
            const tab = deskTabs(source).find((entry) => entry.id === id);
            if (!tab || deskId === source.id) return {};
            const layout = closeTabInLayout({
              layout: source.layout,
              tabId: id,
              explorerSidebarPaneId: null,
            });
            const { id: _id, ...input } = tab;
            return {
              desks: state.desks.map((desk) => {
                if (desk.id === source.id) return withLayout(desk, layout);
                if (desk.id === deskId)
                  return openInDesk(desk, input, true, FOCUSED_PANE_PLACEMENT);
                return desk;
              }),
            };
          }),
        keepPreview: () => change((desk) => ({ ...desk, previewTabId: null })),
        updateTab: (id, patch) =>
          set((state) => ({ desks: state.desks.map((desk) => updateDeskTab(desk, id, patch)) })),
        createNewTab: (owner, paneId) =>
          changeLayout(
            (layout) =>
              createTabInLayout({
                layout,
                target: { kind: "new_tab" },
                now: Date.now(),
                placement: paneId ? { mode: "pane", paneId } : FOCUSED_PANE_PLACEMENT,
                explorerSidebarPaneId: null,
                createTabId: newId,
              })?.layout ?? null,
            owner,
          ),
        splitPane: (input) =>
          changeLayout(
            (layout) =>
              splitPaneInLayout({ layout, ...input, createNodeId, maxTreeDepth: MAX_TREE_DEPTH })
                ?.layout ?? null,
          ),
        splitPaneEmpty: (input, owner) =>
          changeLayout(
            (layout) =>
              splitPaneEmptyInLayout({
                layout,
                ...input,
                createNodeId,
                maxTreeDepth: MAX_TREE_DEPTH,
              })?.layout ?? null,
            owner,
          ),
        moveTabToPane: (tabId, toPaneId) =>
          changeLayout((layout) => moveTabToPaneInLayout({ layout, tabId, toPaneId })),
        focusPane: (paneId) => changeLayout((layout) => focusPaneInLayout({ layout, paneId })),
        selectTabInPane: (paneId, tabId) =>
          changeLayout((layout) => selectTabInPaneInLayout({ layout, paneId, tabId })),
        resizeSplit: (groupId, sizes) =>
          changeLayout((layout) => resizeSplitInLayout({ layout, groupId, sizes })),
        reorderTabsInPane: (paneId, tabIds) =>
          changeLayout((layout) => reorderPaneTabsInLayout({ layout, paneId, tabIds })),
        setTabExplorerOpen: (tabId, open) =>
          change((desk) => {
            const current = desk.explorerTabIds ?? [];
            if (current.includes(tabId) === open) return desk;
            const explorerTabIds = open
              ? [...current, tabId]
              : current.filter((id) => id !== tabId);
            return { ...desk, explorerTabIds };
          }),
        toggleBottomPanel: (owner) => {
          const result = toggleBottomPanelInLayout({
            layout: activeDesk(get()).layout,
            explorerSidebarPaneId: null,
            createNodeId,
          });
          if (result) changeLayout(() => result.layout, owner);
          return result;
        },
        setProjects: (projectKeys) => set({ projectKeys }),
        setSort: (sort) => set({ sort }),
      };
    },
    {
      name: "custom-desks",
      version: 2,
      storage: createValidatedPersistStorage(AsyncStorage, schema),
      migrate: (persisted) => persisted as PersistedDesks,
      merge: (persisted, current) => {
        const state = persisted as Partial<PersistedDesks> | undefined;
        if (!state?.desks) return current;
        return { ...current, ...state, desks: state.desks.map(migrateLegacyDesk) };
      },
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
