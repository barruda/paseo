import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: vi.fn(async () => null),
    setItem: vi.fn(async () => undefined),
    removeItem: vi.fn(async () => undefined),
  },
}));

import { DEFAULT_APP_SETTINGS } from "@/hooks/use-settings";
import { useSessionStore, type WorkspaceDescriptor } from "@/stores/session-store";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import {
  activeDesk,
  activeDeskTab,
  deskTabs,
  initialDesks,
  useDesksStore,
} from "@/task-navigation/desks-store";
import { useTaskNavigationStore } from "@/task-navigation/store";
import { openSubagentTab } from "./open-tab";

const SERVER_ID = "server-1";
const WORKSPACE_ID = "workspace-1";
const WORKSPACE_KEY = `${SERVER_ID}:${WORKSPACE_ID}`;

const WORKSPACE: WorkspaceDescriptor = {
  id: WORKSPACE_ID,
  projectId: "project-1",
  projectDisplayName: "Project",
  projectRootPath: "/repo",
  workspaceDirectory: "/repo",
  projectKind: "git",
  workspaceKind: "local_checkout",
  name: "main",
  status: "done",
  statusEnteredAt: null,
  archivingAt: null,
  createdAt: null,
  lastUserMessageAt: null,
  diffStat: null,
  scripts: [],
};

const PROVIDER_TARGET = {
  kind: "provider_subagent" as const,
  parentAgentId: "parent-agent",
  subagentId: "provider-child",
};
const AGENT_TARGET = { kind: "agent" as const, agentId: "child-agent" };

function open(target: typeof PROVIDER_TARGET | typeof AGENT_TARGET) {
  return openSubagentTab({
    workspaceKey: WORKSPACE_KEY,
    target,
    preferences: DEFAULT_APP_SETTINGS.openInSidePane,
    parentTabId: "parent-tab",
  });
}

beforeEach(() => {
  const session = useSessionStore.getState();
  session.initializeSession(SERVER_ID, null);
  session.setWorkspaces(SERVER_ID, new Map([[WORKSPACE.id, WORKSPACE]]));
  useDesksStore.setState({ desks: initialDesks(), activeDeskId: "primary" });
  useWorkspaceLayoutStore.setState({
    layoutMode: "split-panes",
    sheetsByWorkspace: {},
    layoutByWorkspace: {},
    explorerSidebarPaneIdByWorkspace: {},
    sidePaneIdByWorkspace: {},
  });
});

afterEach(() => {
  useTaskNavigationStore.getState().setEnabled(false);
  useSessionStore.getState().clearSession(SERVER_ID);
});

describe("openSubagentTab", () => {
  it("opens and focuses the provider subagent in the workspace panes outside Tasks mode", () => {
    const tabId = open(PROVIDER_TARGET);

    const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[WORKSPACE_KEY];
    const tab = layout ? collectAllTabs(layout.root).find((entry) => entry.tabId === tabId) : null;
    expect(tab?.target).toEqual(PROVIDER_TARGET);
    expect(deskTabs(activeDesk(useDesksStore.getState()))).toEqual([]);
  });

  it("opens the subagent in the Desk in Tasks mode, where the tabs actually render", () => {
    useTaskNavigationStore.getState().setEnabled(true);

    const tabId = open(PROVIDER_TARGET);

    const opened = activeDeskTab(useDesksStore.getState());
    expect(opened).toMatchObject({
      id: tabId,
      serverId: SERVER_ID,
      workspaceId: WORKSPACE_ID,
      target: PROVIDER_TARGET,
    });
    expect(useWorkspaceLayoutStore.getState().layoutByWorkspace[WORKSPACE_KEY]).toBeUndefined();
  });

  it("focuses an already-open subagent instead of opening a second tab", () => {
    useTaskNavigationStore.getState().setEnabled(true);
    const first = open(PROVIDER_TARGET);

    useDesksStore.getState().createNewTab({ serverId: SERVER_ID, workspaceId: WORKSPACE_ID });
    const second = open(PROVIDER_TARGET);

    expect(second).toBe(first);
    expect(
      deskTabs(activeDesk(useDesksStore.getState())).filter(
        (tab) =>
          tab.target.kind === "provider_subagent" &&
          tab.target.subagentId === PROVIDER_TARGET.subagentId,
      ),
    ).toHaveLength(1);
    expect(activeDeskTab(useDesksStore.getState())?.id).toBe(first);
  });

  it("opens a Paseo subagent's agent tab the same way", () => {
    useTaskNavigationStore.getState().setEnabled(true);

    const tabId = open(AGENT_TARGET);

    expect(activeDeskTab(useDesksStore.getState())).toMatchObject({
      id: tabId,
      target: AGENT_TARGET,
    });
  });
});
