import { beforeEach, describe, expect, it } from "vitest";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSidebarViewStore } from "@/stores/sidebar-view-store";
import { useTaskNavigationStore } from "./store";

describe("task navigation mode", () => {
  beforeEach(async () => {
    await useTaskNavigationStore.persist.rehydrate();
    useTaskNavigationStore.getState().setEnabled(false);
  });
  it("returns to the workspace sidebar without losing its grouping or filters", () => {
    useSidebarViewStore.setState({
      groupMode: "status",
      projectFilters: ["project-a"],
      hostFilters: ["home"],
    });
    const { setEnabled } = useTaskNavigationStore.getState();
    setEnabled(true);
    expect(useTaskNavigationStore.getState().enabled).toBe(true);
    setEnabled(false);
    expect(useTaskNavigationStore.getState().enabled).toBe(false);
    expect(useSidebarViewStore.getState()).toMatchObject({
      groupMode: "status",
      projectFilters: ["project-a"],
      hostFilters: ["home"],
    });
  });
  it("persists the mode separately from workspace sidebar preferences", async () => {
    useTaskNavigationStore.getState().setEnabled(true);
    expect(JSON.parse((await AsyncStorage.getItem("custom-task-navigation"))!)).toEqual({
      version: 1,
      state: { enabled: true },
    });
  });
});

import {
  activeDesk,
  activeDeskTab,
  initialDesks,
  useDesksStore,
  type DeskTabInput,
} from "./desks-store";
const firstTab: DeskTabInput = {
  serverId: "home",
  workspaceId: "paseo",
  target: { kind: "agent", agentId: "one" },
};
const secondTab: DeskTabInput = {
  serverId: "home",
  workspaceId: "unity",
  target: { kind: "agent", agentId: "two" },
};
describe("Desks", () => {
  beforeEach(async () => {
    await useDesksStore.persist.rehydrate();
    useDesksStore.setState({
      desks: initialDesks(),
      activeDeskId: "primary",
      initialized: false,
      projectKeys: null,
      sort: "attention",
      openedAt: {},
    });
  });
  it("replaces the preview across projects while pinned tabs keep their source workspace", () => {
    const store = useDesksStore.getState();
    store.openTab(firstTab, true);
    store.openTab(secondTab);
    const pinned = activeDesk(useDesksStore.getState()).tabs[0];
    store.openTab({ ...firstTab, target: { kind: "agent", agentId: "third" } });
    expect(activeDesk(useDesksStore.getState()).tabs).toEqual([pinned]);
    expect(activeDeskTab(useDesksStore.getState())?.target).toEqual({
      kind: "agent",
      agentId: "third",
    });
    store.openTab(firstTab);
    expect(activeDeskTab(useDesksStore.getState())).toEqual(pinned);
  });
  it("promotes a preview without duplicating it and closes only its reference", () => {
    const store = useDesksStore.getState();
    store.openTab(firstTab);
    const preview = activeDesk(useDesksStore.getState()).preview!;
    store.keepPreview();
    store.openTab(firstTab, true);
    expect(activeDesk(useDesksStore.getState())).toMatchObject({
      preview: null,
      tabs: [preview],
      activeTabId: preview.id,
    });
    store.closeTab(preview.id);
    expect(activeDesk(useDesksStore.getState())).toMatchObject({ tabs: [], activeTabId: null });
  });
  it("restores independent Desks, allowing the same agent in each", async () => {
    const store = useDesksStore.getState();
    store.openTab(firstTab, true);
    const primary = activeDesk(useDesksStore.getState());
    store.createDesk("While waiting");
    store.openTab(firstTab, true);
    store.openTab(secondTab);
    const waiting = activeDesk(useDesksStore.getState());
    expect(waiting.tabs[0]?.target).toEqual(primary.tabs[0]?.target);
    expect(waiting.tabs[0]?.id).not.toBe(primary.tabs[0]?.id);
    store.selectDesk(primary.id);
    expect(activeDesk(useDesksStore.getState())).toEqual(primary);
    await useDesksStore.persist.rehydrate();
    store.selectDesk(waiting.id);
    expect(activeDesk(useDesksStore.getState())).toEqual(waiting);
    store.closeTab(waiting.tabs[0]!.id);
    store.selectDesk(primary.id);
    expect(activeDesk(useDesksStore.getState())).toEqual(primary);
  });
  it("qualifies targets by host and keeps explicit empty project selection across reload", async () => {
    const store = useDesksStore.getState();
    store.openTab(firstTab, true);
    store.openTab({ ...firstTab, serverId: "work" }, true);
    expect(activeDesk(useDesksStore.getState()).tabs).toHaveLength(2);
    store.setProjects([]);
    store.setSort("activity");
    await useDesksStore.persist.rehydrate();
    expect(useDesksStore.getState()).toMatchObject({ projectKeys: [], sort: "activity" });
  });
});

it("keeps state updates attached to their original Desk while another Desk is active", () => {
  useDesksStore.setState({ desks: initialDesks(), activeDeskId: "primary" });
  const store = useDesksStore.getState();
  store.openTab({ ...firstTab, target: { kind: "file", path: "README.md" } }, true);
  const tab = activeDeskTab(useDesksStore.getState())!;
  store.createDesk("Other work");
  store.updateTab(tab.id, { state: { scrollTop: 120 } });
  expect(activeDesk(useDesksStore.getState()).tabs).toEqual([]);
  store.selectDesk("primary");
  expect(activeDeskTab(useDesksStore.getState())?.state).toEqual({ scrollTop: 120 });
});

import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { openDeskTarget } from "./open-desk-target";
it("routes existing launchers into Desks only when enabled, preserving source layouts", () => {
  const session = useSessionStore.getState();
  session.initializeSession("bridge-host", null);
  const workspace: WorkspaceDescriptor = {
    id: "bridge-workspace",
    projectId: "bridge-project",
    projectDisplayName: "Bridge",
    projectRootPath: "/bridge",
    workspaceDirectory: "/bridge",
    projectKind: "git",
    workspaceKind: "local_checkout",
    name: "main",
    status: "done",
    statusEnteredAt: null,
    archivingAt: null,
    diffStat: null,
    scripts: [],
  };
  session.setWorkspaces("bridge-host", new Map([[workspace.id, workspace]]));
  const layoutsBefore = useWorkspaceLayoutStore.getState().layoutByWorkspace;
  const input = {
    workspaceKey: "bridge-host:bridge-workspace",
    target: { kind: "agent" as const, agentId: "bridge-agent" },
    pin: true,
  };
  try {
    useTaskNavigationStore.getState().setEnabled(false);
    expect(openDeskTarget(input)).toBeNull();
    useTaskNavigationStore.getState().setEnabled(true);
    const tabId = openDeskTarget(input);
    expect(activeDeskTab(useDesksStore.getState())).toMatchObject({
      id: tabId,
      serverId: "bridge-host",
      workspaceId: "bridge-workspace",
      target: input.target,
    });
    expect(useWorkspaceLayoutStore.getState().layoutByWorkspace).toBe(layoutsBefore);
    expect(openDeskTarget({ ...input, workspaceKey: "unknown" })).toBeNull();
  } finally {
    useTaskNavigationStore.getState().setEnabled(false);
    session.clearSession("bridge-host");
  }
});
