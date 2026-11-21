// CUSTOM(assistant-desk), CUSTOM(pm-sidebar)
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routes = vi.hoisted(() => ({
  workspace: [] as string[],
  last: null as { serverId: string; workspaceId: string } | null,
}));

vi.mock("@/navigation/workspace-route-navigation", () => ({
  navigateToHostWorkspaceRoute: (route: string) => routes.workspace.push(route),
}));
vi.mock("@/stores/navigation-active-workspace-store", () => ({
  getLastWorkspaceSelection: () => routes.last,
}));

const focusChatComposer = vi.hoisted(() => vi.fn((_serverId: string, _agentId: string) => true));
vi.mock("@/chat-esc-focus/registry", () => ({ focusChatComposer }));

import {
  activeDesk,
  ASSISTANT_DESK_ID,
  deskTabs,
  initialDesks,
  useDesksStore,
} from "@/task-navigation/desks-store";
import { useTaskNavigationStore } from "@/task-navigation/store";
import { AGENT_REPLACES_LABEL } from "@/task-navigation/agent-successor";
import { useDeskWorkboardStore } from "@/task-navigation/desk-workboard-store";
import { useSessionStore, type Agent, type SessionState } from "@/stores/session-store";
import { ASSISTANT_CHAT_LABEL } from "./model";
import {
  currentAssistantChat,
  explorerShowsAssistant,
  focusAssistantComposer,
  followAssistantTab,
  isAssistantChatInSession,
  openAssistantDesk,
  openAssistantSidebar,
} from "./open";
import { queryClient } from "@/data/query-client";
import { APP_SETTINGS_QUERY_KEY, DEFAULT_CLIENT_SETTINGS } from "@/hooks/use-settings/storage";
import { useExplorerLockStore } from "@/explorer-lock/store";
import {
  collectAllTabs,
  findPaneById,
  selectExplorerSidebarPaneId,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { useAssistantSidebarStore } from "./store";

const CHAT = { [ASSISTANT_CHAT_LABEL]: "true" };
const ARCHIVED = new Date("2026-11-19T12:00:00Z");

function agent(input: {
  labels?: Record<string, string>;
  archivedAt?: Date | null;
  workspaceId?: string | null;
}): Agent {
  return {
    id: "chat",
    labels: input.labels ?? {},
    archivedAt: input.archivedAt ?? null,
    workspaceId: input.workspaceId ?? "ws",
    createdAt: null,
  } as unknown as Agent;
}

function seedSession(input: {
  agents?: [string, Agent][];
  agentDetails?: [string, Agent][];
  hydrated?: boolean;
}): void {
  useSessionStore.setState({
    sessions: {
      s1: {
        serverId: "s1",
        agents: new Map(input.agents ?? []),
        agentDetails: new Map(input.agentDetails ?? []),
        hasHydratedAgents: input.hydrated ?? true,
      } as unknown as SessionState,
    },
  });
}

beforeEach(() => {
  routes.workspace.length = 0;
  routes.last = null;
  useSessionStore.setState({ sessions: {} });
  useDeskWorkboardStore.setState({ selected: null });
  useAssistantSidebarStore.setState({ chat: null, pending: null, requested: null });
  useTaskNavigationStore.setState({ enabled: true });
  useDesksStore.setState({ desks: initialDesks(), activeDeskId: "primary", initialized: true });
  // CUSTOM(pm-sidebar)
  queryClient.setQueryData(APP_SETTINGS_QUERY_KEY, DEFAULT_CLIENT_SETTINGS);
  useExplorerLockStore.setState({ open: false });
  useWorkspaceLayoutStore.setState({ layoutByWorkspace: {}, explorerSidebarPaneIdByWorkspace: {} });
});

describe("isAssistantChatInSession", () => {
  it("knows a live labeled chat in either agent map", () => {
    seedSession({
      agents: [["live", agent({ labels: CHAT })]],
      agentDetails: [["detail", agent({ labels: CHAT })]],
    });
    expect(isAssistantChatInSession("s1", "live")).toBe(true);
    expect(isAssistantChatInSession("s1", "detail")).toBe(true);
  });

  it("leaves an archived chat, an unlabeled agent and a missing one to ordinary navigation", () => {
    seedSession({
      agents: [
        ["old", agent({ labels: CHAT, archivedAt: ARCHIVED })],
        ["plain", agent({ labels: {} })],
      ],
    });
    expect(isAssistantChatInSession("s1", "old")).toBe(false);
    expect(isAssistantChatInSession("s1", "plain")).toBe(false);
    expect(isAssistantChatInSession("s1", "missing")).toBe(false);
  });
});

describe("currentAssistantChat", () => {
  it("follows a compaction to the chat that replaced the remembered one", () => {
    seedSession({
      agents: [
        ["old", agent({ labels: CHAT, archivedAt: ARCHIVED })],
        ["next", agent({ labels: { ...CHAT, [AGENT_REPLACES_LABEL]: "old" } })],
      ],
    });
    useAssistantSidebarStore.getState().setChat({ serverId: "s1", agentId: "old" });
    expect(currentAssistantChat("s1")).toEqual({ serverId: "s1", agentId: "next" });
  });
});

describe("openAssistantDesk", () => {
  it("returns null in workspace mode, so ordinary navigation runs", () => {
    useTaskNavigationStore.setState({ enabled: false });
    expect(openAssistantDesk({ chat: { serverId: "s1", agentId: "chat" } })).toBeNull();
    expect(routes.workspace).toEqual([]);
    expect(useAssistantSidebarStore.getState().chat).toEqual({ serverId: "s1", agentId: "chat" });
  });

  it("shows the chat in its own Desk, drops the board chip and shows the last workspace", () => {
    routes.last = { serverId: "s1", workspaceId: "ws" };
    seedSession({ agents: [["chat", agent({ labels: CHAT, workspaceId: "ws-chat" })]] });
    useDeskWorkboardStore.setState({ selected: "power-workboard" });

    const route = openAssistantDesk({ chat: { serverId: "s1", agentId: "chat" } });

    expect(route).toBe("/h/s1/workspace/ws");
    expect(routes.workspace).toEqual(["/h/s1/workspace/ws"]);
    const desks = useDesksStore.getState();
    expect(desks.activeDeskId).toBe(ASSISTANT_DESK_ID);
    expect(deskTabs(activeDesk(desks)).map((tab) => [tab.workspaceId, tab.target])).toEqual([
      ["ws-chat", { kind: "agent", agentId: "chat" }],
    ]);
    expect(useDeskWorkboardStore.getState().selected).toBeNull();
    expect(useAssistantSidebarStore.getState().pending).toBeNull();
  });

  it("opening twice keeps one tab", () => {
    seedSession({ agents: [["chat", agent({ labels: CHAT })]] });
    openAssistantDesk({ chat: { serverId: "s1", agentId: "chat" } });
    openAssistantDesk({ chat: { serverId: "s1", agentId: "chat" } });
    expect(deskTabs(activeDesk(useDesksStore.getState()))).toHaveLength(1);
  });

  it("falls back to the chat's own workspace when no workspace was shown yet", () => {
    seedSession({ agents: [["chat", agent({ labels: CHAT, workspaceId: "ws-chat" })]] });

    expect(openAssistantDesk({ chat: { serverId: "s1", agentId: "chat" } })).toBe(
      "/h/s1/workspace/ws-chat",
    );
    expect(routes.workspace).toEqual(["/h/s1/workspace/ws-chat"]);
  });

  it("keeps a chat the session does not list yet as pending and still selects the Desk", () => {
    expect(openAssistantDesk({ chat: { serverId: "s1", agentId: "chat" } })).toBe("");
    expect(routes.workspace).toEqual([]);
    expect(useAssistantSidebarStore.getState()).toMatchObject({
      chat: { serverId: "s1", agentId: "chat" },
      pending: { serverId: "s1", agentId: "chat" },
    });
    const desks = useDesksStore.getState();
    expect(desks.activeDeskId).toBe(ASSISTANT_DESK_ID);
    expect(desks.desks.some((desk) => desk.id === ASSISTANT_DESK_ID)).toBe(true);
    expect(deskTabs(activeDesk(desks))).toEqual([]);
  });
});

// CUSTOM(pm-sidebar)
describe("openAssistantSidebar", () => {
  const WS = "s1:ws";

  function explorerTabs() {
    const store = useWorkspaceLayoutStore.getState();
    const layout = store.layoutByWorkspace[WS];
    const pane = layout ? findPaneById(layout.root, selectExplorerSidebarPaneId(store, WS)) : null;
    if (!layout || !pane) return { tabs: [], focused: null };
    const tabs = collectAllTabs(layout.root).filter((tab) => pane.tabIds.includes(tab.tabId));
    return { tabs, focused: pane.focusedTabId };
  }

  function assistantTabs() {
    return explorerTabs().tabs.filter((tab) => tab.target.kind === "projects_assistant");
  }

  it("returns null in workspace mode, so ordinary navigation runs", () => {
    useTaskNavigationStore.setState({ enabled: false });
    expect(openAssistantSidebar({ chat: { serverId: "s1", agentId: "chat" } })).toBeNull();
    expect(useAssistantSidebarStore.getState().chat).toEqual({ serverId: "s1", agentId: "chat" });
  });

  it("opens the right sidebar on a new Project Manager tab, without a Desk", () => {
    routes.last = { serverId: "s1", workspaceId: "ws" };
    seedSession({ agents: [["chat", agent({ labels: CHAT })]] });
    useDeskWorkboardStore.setState({ selected: "power-workboard" });

    const route = openAssistantSidebar({ chat: { serverId: "s1", agentId: "chat" } });

    expect(route).toBe("/h/s1/workspace/ws");
    expect(useExplorerLockStore.getState().open).toBe(true);
    expect(assistantTabs()).toHaveLength(1);
    expect(explorerTabs().focused).toBe(assistantTabs()[0]!.tabId);
    const desks = useDesksStore.getState();
    expect(desks.activeDeskId).toBe("primary");
    expect(desks.desks.some((desk) => desk.id === ASSISTANT_DESK_ID)).toBe(false);
    expect(useDeskWorkboardStore.getState().selected).toBeNull();
    expect(useAssistantSidebarStore.getState().chat).toEqual({ serverId: "s1", agentId: "chat" });
  });

  it("focuses the existing Project Manager tab instead of opening another", () => {
    routes.last = { serverId: "s1", workspaceId: "ws" };
    openAssistantSidebar({ chat: null });
    const store = useWorkspaceLayoutStore.getState();
    const paneId = selectExplorerSidebarPaneId(store, WS)!;
    store.openTab({
      workspaceKey: WS,
      target: { kind: "files" },
      intent: "reveal",
      placement: { mode: "pane", paneId },
    });
    expect(explorerTabs().focused).not.toBe(assistantTabs()[0]!.tabId);

    openAssistantSidebar({ chat: null });

    expect(assistantTabs()).toHaveLength(1);
    expect(explorerTabs().focused).toBe(assistantTabs()[0]!.tabId);
  });

  it("without the lock, opens the right sidebar of the focused Desk tab", () => {
    queryClient.setQueryData(APP_SETTINGS_QUERY_KEY, {
      ...DEFAULT_CLIENT_SETTINGS,
      explorerLockTasks: false,
    });
    useDesksStore
      .getState()
      .openTab({ serverId: "s1", workspaceId: "ws", target: { kind: "file", path: "a.ts" } }, true);
    const tabId = deskTabs(activeDesk(useDesksStore.getState()))[0]!.id;

    openAssistantSidebar({ chat: null });

    expect(activeDesk(useDesksStore.getState()).explorerTabIds).toEqual([tabId]);
    expect(useExplorerLockStore.getState().open).toBe(false);
    expect(assistantTabs()).toHaveLength(1);
  });

  it("with no workspace to dock beside, falls back to the Project Manager Desk", () => {
    openAssistantSidebar({ chat: null });

    expect(useDesksStore.getState().activeDeskId).toBe(ASSISTANT_DESK_ID);
    expect(useExplorerLockStore.getState().open).toBe(false);
  });

  it("from the Project Manager Desk, closes the Desk and goes back to the sidebar", () => {
    routes.last = { serverId: "s1", workspaceId: "ws" };
    useDesksStore.getState().selectAssistantDesk();

    openAssistantSidebar({ chat: null });

    const desks = useDesksStore.getState();
    expect(desks.desks.some((desk) => desk.id === ASSISTANT_DESK_ID)).toBe(false);
    expect(desks.activeDeskId).toBe("primary");
    expect(assistantTabs()).toHaveLength(1);
  });

  it("closes a Project Manager Desk left hidden, so it never decides the sidebar's chat", () => {
    routes.last = { serverId: "s1", workspaceId: "ws" };
    seedSession({ agents: [["chat", agent({ labels: CHAT })]] });
    useDesksStore.getState().selectAssistantDesk();
    useDesksStore.getState().selectDesk("primary");

    openAssistantSidebar({ chat: { serverId: "s1", agentId: "chat" } });

    expect(useDesksStore.getState().desks.some((desk) => desk.id === ASSISTANT_DESK_ID)).toBe(
      false,
    );
  });

  it("asks the sidebar to show a chat the session does not list yet", () => {
    routes.last = { serverId: "s1", workspaceId: "ws" };
    seedSession({ agents: [["old", agent({ labels: CHAT })]] });

    openAssistantSidebar({ chat: { serverId: "s1", agentId: "new" } });

    const store = useAssistantSidebarStore.getState();
    expect(store.chat).toEqual({ serverId: "s1", agentId: "new" });
    expect(store.requested).toEqual({ serverId: "s1", agentId: "new" });

    openAssistantSidebar({ chat: { serverId: "s1", agentId: "old" } });
    expect(useAssistantSidebarStore.getState().requested).toBeNull();
  });

  it("keeps one Project Manager tab: opening it beside another workspace closes the old one", () => {
    routes.last = { serverId: "s1", workspaceId: "other" };
    openAssistantSidebar({ chat: null });
    expect(
      useWorkspaceLayoutStore
        .getState()
        .getWorkspaceTabs("s1:other")
        .filter((tab) => tab.target.kind === "projects_assistant"),
    ).toHaveLength(1);

    routes.last = { serverId: "s1", workspaceId: "ws" };
    openAssistantSidebar({ chat: null });

    expect(assistantTabs()).toHaveLength(1);
    expect(
      useWorkspaceLayoutStore
        .getState()
        .getWorkspaceTabs("s1:other")
        .filter((tab) => tab.target.kind === "projects_assistant"),
    ).toHaveLength(0);
  });
});

// CUSTOM(pm-sidebar)
describe("followAssistantTab", () => {
  it("moves the Project Manager tab into the next workspace's Explorer", () => {
    routes.last = { serverId: "s1", workspaceId: "a" };
    openAssistantSidebar({ chat: null });
    expect(explorerShowsAssistant("s1:a")).toBe(true);
    expect(explorerShowsAssistant("s1:b")).toBe(false);

    followAssistantTab("s1:b");

    expect(explorerShowsAssistant("s1:b")).toBe(true);
    const tabsOf = (key: string) =>
      useWorkspaceLayoutStore
        .getState()
        .getWorkspaceTabs(key)
        .filter((tab) => tab.target.kind === "projects_assistant");
    expect(tabsOf("s1:a")).toHaveLength(0);
    expect(tabsOf("s1:b")).toHaveLength(1);
  });
});

// CUSTOM(pm-focus): the Project Manager composer takes the caret only when the user opens it.
describe("Project Manager composer focus", () => {
  const PM = { serverId: "s1", agentId: "chat" };

  beforeEach(() => {
    vi.useFakeTimers();
    routes.last = { serverId: "s1", workspaceId: "a" };
    seedSession({ agents: [["chat", agent({ labels: CHAT })]] });
    focusChatComposer.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opening the sidebar (header button, a link to the chat) focuses its composer", () => {
    openAssistantSidebar({ chat: null });
    vi.advanceTimersByTime(500);
    expect(focusChatComposer).toHaveBeenCalledWith("s1", "chat");

    focusChatComposer.mockClear();
    openAssistantSidebar({ chat: PM });
    vi.advanceTimersByTime(500);
    expect(focusChatComposer).toHaveBeenCalledWith("s1", "chat");
  });

  it("an automatic open (the tab sweep) leaves the caret where it is", () => {
    openAssistantSidebar({ chat: PM, focusComposer: false });
    vi.advanceTimersByTime(5000);
    expect(focusChatComposer).not.toHaveBeenCalled();
  });

  it("the tab following the sidebar to another workspace does not focus it", () => {
    openAssistantSidebar({ chat: null, focusComposer: false });
    followAssistantTab("s1:b");
    vi.advanceTimersByTime(5000);
    expect(explorerShowsAssistant("s1:b")).toBe(true);
    expect(focusChatComposer).not.toHaveBeenCalled();
  });

  it("focusAssistantComposer focuses the current chat's composer", () => {
    focusAssistantComposer();
    vi.advanceTimersByTime(500);
    expect(focusChatComposer).toHaveBeenCalledWith("s1", "chat");
  });
});
