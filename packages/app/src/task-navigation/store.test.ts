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
  deskContextTab,
  deskTabs,
  initialDesks,
  useDesksStore,
  type Desk,
  type DeskTabInput,
} from "./desks-store";
import { collectAllPanes, findPaneContainingTab } from "@/stores/workspace-layout-actions";
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
const desk = () => activeDesk(useDesksStore.getState());
const tabs = () => deskTabs(desk());
const current = () => activeDeskTab(useDesksStore.getState());
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
  it("changes a draft's project workspace without changing its tab or Desk identity", () => {
    const store = useDesksStore.getState();
    store.openTab({ ...firstTab, target: { kind: "draft", draftId: "draft-project-cycle" } }, true);
    const before = current()!;
    const deskId = desk().id;
    store.updateTab(before.id, { workspaceId: "unity" });
    expect(current()).toEqual({ ...before, workspaceId: "unity" });
    expect(desk().id).toBe(deskId);
    expect(tabs()).toHaveLength(1);
  });
  it("keeps the Explorer open per tab, across a draft's project switch, until the tab closes", () => {
    const store = useDesksStore.getState();
    store.openTab({ ...firstTab, target: { kind: "draft", draftId: "draft-explorer" } }, true);
    const draft = current()!;
    store.openTab(secondTab, true);
    const other = current()!;
    store.setTabExplorerOpen(draft.id, true);
    expect(desk().explorerTabIds).toEqual([draft.id]);
    store.updateTab(draft.id, { workspaceId: "unity" });
    expect(desk().explorerTabIds).toEqual([draft.id]);
    store.closeTab(draft.id);
    expect(desk().explorerTabIds).toEqual([]);
    store.setTabExplorerOpen(other.id, true);
    store.setTabExplorerOpen(other.id, false);
    expect(desk().explorerTabIds).toEqual([]);
  });
  it("keeps the last focused agent tab as the context while a bottom panel tab has focus", () => {
    const store = useDesksStore.getState();
    const context = () => deskContextTab(useDesksStore.getState());
    store.openTab(firstTab, true);
    const agent = current()!;
    store.toggleBottomPanel({ serverId: "home", workspaceId: "unity" });
    expect(current()?.workspaceId).toBe("unity");
    expect(context()?.id).toBe(agent.id);
    store.openTab({ ...secondTab, target: { kind: "draft", draftId: "draft-context" } }, true);
    const draft = current()!;
    expect(context()?.id).toBe(draft.id);
    store.updateTab(draft.id, { target: { kind: "agent", agentId: "from-draft" } });
    expect(context()?.target).toEqual({ kind: "agent", agentId: "from-draft" });
    store.closeTab(context()!.id);
    store.openTab({ ...secondTab, target: { kind: "file", path: "/tmp/notes.md" } }, true);
    expect(context()?.id).toBe(agent.id);
    store.closeTab(agent.id);
    expect(context()?.target.kind).toBe("file");
  });
  // CUSTOM(desk-close-returns)
  it("closing a tab returns to the tab it was opened from, not to its neighbor", () => {
    const store = useDesksStore.getState();
    store.openTab(firstTab, true);
    store.openTab(secondTab, true);
    store.openTab({ ...secondTab, target: { kind: "draft", draftId: "draft-close" } }, true);
    store.selectTab(tabs()[0]!.id);
    const origin = current()!;
    store.openTab({ ...firstTab, target: { kind: "file", path: "/tmp/notes.md" } }, true);
    expect(current()?.target.kind).toBe("file");
    store.closeTab(current()!.id);
    expect(current()?.id).toBe(origin.id);
  });
  it("toggles a tabbed bottom pane whose launcher belongs to the given workspace", () => {
    const store = useDesksStore.getState();
    store.openTab(firstTab, true);
    const created = store.toggleBottomPanel({ serverId: "home", workspaceId: "unity" });
    expect(created?.kind).toBe("created");
    const launcherId = created?.kind === "created" ? created.launcherTabId : "";
    const bottom = findPaneContainingTab(desk().layout.root, launcherId)!;
    expect(bottom.id).toBe("bottom-panel");
    expect(desk().owners[launcherId]).toEqual({ serverId: "home", workspaceId: "unity" });
    expect(store.toggleBottomPanel(firstTab)?.kind).toBe("hidden");
    expect(findPaneContainingTab(desk().layout.root, launcherId)?.hidden).toBe(true);
    expect(current()?.target).toEqual(firstTab.target);
    expect(store.toggleBottomPanel(firstTab)?.kind).toBe("shown");
    expect(desk().layout.focusedPaneId).toBe("bottom-panel");
    expect(desk().owners[launcherId]).toEqual({ serverId: "home", workspaceId: "unity" });
  });
  it("closes a workspace's terminal tabs, in every Desk, once its terminal is gone", () => {
    const store = useDesksStore.getState();
    const terminal = (terminalId: string, workspaceId = "paseo"): DeskTabInput => ({
      serverId: "home",
      workspaceId,
      target: { kind: "terminal", terminalId },
    });
    store.openTab(firstTab, true);
    store.openTab(terminal("dead"), true);
    store.openTab(terminal("live"), true);
    store.openTab(terminal("other-workspace", "unity"), true);
    store.createDesk("Second");
    useDesksStore.getState().openTab(terminal("dead"), true);
    const live = new Set(["live"]);
    useDesksStore
      .getState()
      .closeDeadTerminalTabs({ serverId: "home", workspaceId: "paseo" }, live);
    const targetsOf = (entry: Desk) => deskTabs(entry).map((tab) => tab.target);
    const targets = useDesksStore.getState().desks.map(targetsOf);
    expect(targets).toEqual([
      [firstTab.target, terminal("live").target, terminal("other-workspace").target],
      [],
    ]);
    const before = useDesksStore.getState().desks;
    useDesksStore
      .getState()
      .closeDeadTerminalTabs({ serverId: "home", workspaceId: "paseo" }, live);
    expect(useDesksStore.getState().desks).toBe(before);
  });
  it("replaces the preview across projects while pinned tabs keep their source workspace", () => {
    const store = useDesksStore.getState();
    store.openTab(firstTab, true);
    store.openTab(secondTab);
    const pinned = tabs()[0];
    store.openTab({ ...firstTab, target: { kind: "agent", agentId: "third" } });
    expect(tabs()).toHaveLength(2);
    expect(tabs()[0]).toEqual(pinned);
    expect(current()).toMatchObject({
      serverId: "home",
      workspaceId: "paseo",
      target: { kind: "agent", agentId: "third" },
    });
    expect(desk().previewTabId).toBe(current()!.id);
    store.openTab(firstTab);
    expect(current()).toEqual(pinned);
  });
  it("promotes a preview without duplicating it and closes only its reference", () => {
    const store = useDesksStore.getState();
    store.openTab(firstTab);
    const preview = current()!;
    expect(desk().previewTabId).toBe(preview.id);
    store.keepPreview();
    store.openTab(firstTab, true);
    expect(desk().previewTabId).toBeNull();
    expect(tabs()).toEqual([preview]);
    store.closeTab(preview.id);
    expect(tabs()).toEqual([]);
    expect(current()).toBeNull();
  });
  it("restores independent Desks, allowing the same agent in each", async () => {
    const store = useDesksStore.getState();
    store.openTab(firstTab, true);
    const primary = desk();
    store.createDesk("While waiting");
    store.openTab(firstTab, true);
    store.openTab(secondTab);
    const waiting = desk();
    expect(deskTabs(waiting)[0]?.target).toEqual(deskTabs(primary)[0]?.target);
    expect(deskTabs(waiting)[0]?.id).not.toBe(deskTabs(primary)[0]?.id);
    store.selectDesk(primary.id);
    expect(desk()).toEqual(primary);
    await useDesksStore.persist.rehydrate();
    store.selectDesk(waiting.id);
    expect(tabs()).toEqual(deskTabs(waiting));
    store.closeTab(deskTabs(waiting)[0]!.id);
    store.selectDesk(primary.id);
    expect(tabs()).toEqual(deskTabs(primary));
  });
  it("renames and deletes any Desk by id, keeping one Desk and the agents it referenced", () => {
    const store = useDesksStore.getState();
    store.openTab(firstTab, true);
    store.createDesk("Later");
    const later = desk().id;
    store.selectDesk("primary");
    store.renameDesk(later, "Afternoon");
    expect(useDesksStore.getState().desks.map((entry) => entry.name)).toEqual([
      "Primary tasks",
      "Afternoon",
    ]);
    expect(desk().id).toBe("primary");
    store.deleteDesk("primary");
    expect(useDesksStore.getState().desks.map((entry) => entry.id)).toEqual([later]);
    expect(desk().id).toBe(later);
    store.deleteDesk(later);
    expect(useDesksStore.getState().desks.map((entry) => entry.id)).toEqual([later]);
  });
  it("moves a tab into another Desk as a kept tab without switching Desks", () => {
    const store = useDesksStore.getState();
    store.createDesk("Later");
    const later = desk().id;
    store.selectDesk("primary");
    store.openTab(firstTab, true);
    store.openTab(secondTab);
    const moving = current()!;
    store.moveTabToDesk(moving.id, later);
    expect(desk().id).toBe("primary");
    expect(tabs().map((tab) => tab.target)).toEqual([firstTab.target]);
    store.selectDesk(later);
    expect(tabs()).toHaveLength(1);
    expect(tabs()[0]).toMatchObject({
      serverId: secondTab.serverId,
      workspaceId: secondTab.workspaceId,
      target: secondTab.target,
    });
    expect(desk().previewTabId).toBeNull();
  });
  it("qualifies targets by host and keeps explicit empty project selection across reload", async () => {
    const store = useDesksStore.getState();
    store.openTab(firstTab, true);
    store.openTab({ ...firstTab, serverId: "work" }, true);
    expect(tabs()).toHaveLength(2);
    store.setProjects([]);
    store.setSort("activity");
    await useDesksStore.persist.rehydrate();
    expect(useDesksStore.getState()).toMatchObject({ projectKeys: [], sort: "activity" });
  });
  it("splits tabs from different workspaces into panes and keeps their owners", async () => {
    const store = useDesksStore.getState();
    store.openTab(firstTab, true);
    store.openTab(secondTab, true);
    const [one, two] = tabs();
    const mainPaneId = findPaneContainingTab(desk().layout.root, one!.id)!.id;
    store.splitPane({ tabId: two!.id, targetPaneId: mainPaneId, position: "right" });
    expect(collectAllPanes(desk().layout.root)).toHaveLength(2);
    const sidePaneId = findPaneContainingTab(desk().layout.root, two!.id)!.id;
    expect(sidePaneId).not.toBe(mainPaneId);
    expect(current()).toEqual(two);
    store.focusPane(mainPaneId);
    expect(current()).toEqual(one);
    store.openTab({ ...secondTab, target: { kind: "file", path: "README.md" } }, true, {
      mode: "pane",
      paneId: sidePaneId,
    });
    expect(findPaneContainingTab(desk().layout.root, current()!.id)!.id).toBe(sidePaneId);
    expect(current()).toMatchObject({ workspaceId: "unity" });
    await useDesksStore.persist.rehydrate();
    expect(collectAllPanes(desk().layout.root)).toHaveLength(2);
    expect(tabs().map((tab) => tab.workspaceId)).toEqual(["paseo", "unity", "unity"]);
  });
  it("gives an empty split the workspace it was split from", () => {
    const store = useDesksStore.getState();
    store.openTab(secondTab, true);
    const paneId = desk().layout.focusedPaneId!;
    store.splitPaneEmpty({ targetPaneId: paneId, position: "bottom" }, secondTab);
    const launcher = current()!;
    expect(launcher).toMatchObject({ workspaceId: "unity", target: { kind: "new_tab" } });
    store.updateTab(launcher.id, { ...firstTab, target: { kind: "terminal", terminalId: "t1" } });
    expect(current()).toMatchObject({ workspaceId: "paseo", target: { kind: "terminal" } });
  });
  it("migrates a Desk saved as a flat tab list", async () => {
    await AsyncStorage.setItem(
      "custom-desks",
      JSON.stringify({
        version: 1,
        state: {
          desks: [
            {
              id: "primary",
              name: "Primary tasks",
              tabs: [{ id: "pinned", ...firstTab }],
              preview: { id: "preview", ...secondTab },
              activeTabId: "pinned",
            },
          ],
          activeDeskId: "primary",
          initialized: true,
          projectKeys: null,
          sort: "attention",
          openedAt: {},
        },
      }),
    );
    await useDesksStore.persist.rehydrate();
    expect(tabs().map((tab) => tab.id)).toEqual(["preview", "pinned"]);
    expect(current()).toMatchObject({ id: "pinned", workspaceId: "paseo" });
    expect(desk().previewTabId).toBe("preview");
  });
});

it("keeps state updates attached to their original Desk while another Desk is active", () => {
  useDesksStore.setState({ desks: initialDesks(), activeDeskId: "primary" });
  const store = useDesksStore.getState();
  store.openTab({ ...firstTab, target: { kind: "file", path: "README.md" } }, true);
  const tab = current()!;
  store.createDesk("Other work");
  store.updateTab(tab.id, { state: { scrollTop: 120 } });
  expect(tabs()).toEqual([]);
  store.selectDesk("primary");
  expect(current()?.state).toEqual({ scrollTop: 120 });
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
