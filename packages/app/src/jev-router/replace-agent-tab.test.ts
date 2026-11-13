import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { initialDesks, deskTabs, useDesksStore } from "@/task-navigation/desks-store";
import { useTaskNavigationStore } from "@/task-navigation/store";
import { replaceAgentTabInPlace, replaceDeskAgentTab } from "./replace-agent-tab";

const KEY = "server-1:workspace-1";
const base = { serverId: "server-1", workspaceId: "workspace-1" };

beforeEach(() => {
  useTaskNavigationStore.setState({ enabled: false });
  useDesksStore.setState({ desks: initialDesks(), activeDeskId: "primary", openedAt: {} });
  useWorkspaceLayoutStore.setState({
    layoutMode: "split-panes",
    sheetsByWorkspace: {},
    layoutByWorkspace: {},
    explorerSidebarPaneIdByWorkspace: {},
    sidePaneIdByWorkspace: {},
  });
});

function tabs() {
  const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[KEY];
  return layout ? collectAllTabs(layout.root) : [];
}

describe("replaceAgentTabInPlace", () => {
  it("retargets the old agent's tab, keeping its id and position", () => {
    const store = useWorkspaceLayoutStore.getState();
    store.openTab({ workspaceKey: KEY, target: { kind: "file", path: "a.ts" }, intent: "reveal" });
    const oldTabId = store.openTab({
      workspaceKey: KEY,
      target: { kind: "agent", agentId: "old" },
      intent: "reveal",
    });
    const before = tabs().length;
    expect(replaceAgentTabInPlace({ ...base, oldAgentId: "old", newAgentId: "new" })).toBe(true);
    const after = tabs();
    expect(after).toHaveLength(before);
    expect(after.find((tab) => tab.tabId === oldTabId)?.target).toEqual({
      kind: "agent",
      agentId: "new",
    });
  });

  it("returns false when no tab shows the old agent", () => {
    useWorkspaceLayoutStore.getState().openTab({
      workspaceKey: KEY,
      target: { kind: "agent", agentId: "other" },
      intent: "reveal",
    });
    const before = tabs().length;
    expect(replaceAgentTabInPlace({ ...base, oldAgentId: "old", newAgentId: "new" })).toBe(false);
    expect(tabs()).toHaveLength(before);
  });
});

describe("replaceDeskAgentTab", () => {
  const owner = { serverId: "server-1", workspaceId: "workspace-1" };
  const allTabs = () => useDesksStore.getState().desks.flatMap(deskTabs);

  it("retargets the desk tab in place and moves its opened entry", () => {
    const desks = useDesksStore.getState();
    desks.openTab({ ...owner, target: { kind: "file", path: "a.ts" } }, true);
    desks.openTab({ ...owner, target: { kind: "agent", agentId: "old" } }, true);
    const oldTab = allTabs().find((tab) => tab.target.kind === "agent");
    const before = allTabs().length;
    expect(replaceDeskAgentTab({ ...owner, oldAgentId: "old", newAgentId: "new" })).toBe(true);
    expect(allTabs()).toHaveLength(before);
    const after = allTabs().find((tab) => tab.id === oldTab?.id);
    expect(after?.target).toEqual({ kind: "agent", agentId: "new" });
    expect(after).toMatchObject(owner);
    const { openedAt } = useDesksStore.getState();
    expect(openedAt["server-1:old"]).toBeUndefined();
    expect(openedAt["server-1:new"]).toBeTypeOf("number");
  });

  it("replaceAgentTabInPlace uses the desks only when Desks is enabled", () => {
    useDesksStore.getState().openTab({ ...owner, target: { kind: "agent", agentId: "old" } }, true);
    const args = { ...owner, oldAgentId: "old", newAgentId: "new" };
    expect(replaceAgentTabInPlace(args)).toBe(false);
    useTaskNavigationStore.setState({ enabled: true });
    expect(replaceAgentTabInPlace(args)).toBe(true);
  });

  it("returns false when no desk tab shows the old agent", () => {
    expect(replaceDeskAgentTab({ ...owner, oldAgentId: "old", newAgentId: "new" })).toBe(false);
  });
});
