/**
 * @vitest-environment jsdom
 */
// CUSTOM(assistant-desk)
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const routes = vi.hoisted(() => ({ workspace: [] as string[] }));
vi.mock("@/navigation/workspace-route-navigation", () => ({
  navigateToHostWorkspaceRoute: (route: string) => routes.workspace.push(route),
}));
const focusChatComposer = vi.hoisted(() => vi.fn(() => true));
vi.mock("@/chat-esc-focus/registry", () => ({ focusChatComposer }));
vi.mock("@/stores/navigation-active-workspace-store", () => ({
  getLastWorkspaceSelection: () => null,
}));

import { useSessionStore, type Agent, type SessionState } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { collectAllTabs } from "@/stores/workspace-layout-actions";
import {
  activeDesk,
  ASSISTANT_DESK_ID,
  deskTabs,
  initialDesks,
  useDesksStore,
} from "@/task-navigation/desks-store";
import { useTaskNavigationStore } from "@/task-navigation/store";
import { ASSISTANT_CHAT_LABEL } from "./model";
import { useAssistantSidebarStore } from "./store";
import { useAssistantTabSweep } from "./use-assistant-tab-sweep";

const CHAT = { [ASSISTANT_CHAT_LABEL]: "true" };
const OWNER = { serverId: "s1", workspaceId: "ws" };

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "chat",
    labels: CHAT,
    archivedAt: null,
    workspaceId: "ws",
    createdAt: null,
    ...overrides,
  } as unknown as Agent;
}

function seedSession(input: {
  agents?: [string, Agent][];
  agentDetails?: [string, Agent][];
}): void {
  useSessionStore.setState({
    sessions: {
      s1: {
        serverId: "s1",
        agents: new Map(input.agents ?? []),
        agentDetails: new Map(input.agentDetails ?? []),
        hasHydratedAgents: true,
      } as unknown as SessionState,
    },
  });
}

function openChatTab(): string | null {
  useDesksStore.getState().openTab({
    ...OWNER,
    target: { kind: "agent", agentId: "chat" },
  });
  // A sweep subscribed to the store may already have closed it.
  return deskTabs(activeDesk(useDesksStore.getState()))[0]?.id ?? null;
}

const deskTabIds = () => deskTabs(activeDesk(useDesksStore.getState())).map((tab) => tab.id);

beforeAll(async () => {
  await useDesksStore.persist.rehydrate();
  await useWorkspaceLayoutStore.persist.rehydrate();
});

afterEach(cleanup);

beforeEach(() => {
  routes.workspace.length = 0;
  useDesksStore.setState({
    desks: initialDesks(),
    activeDeskId: "primary",
    initialized: false,
    openedAt: {},
  });
  useWorkspaceLayoutStore.setState({
    layoutByWorkspace: {},
    explorerSidebarPaneIdByWorkspace: {},
    sidePaneIdByWorkspace: {},
    splitSizesByWorkspace: {},
  });
  useSessionStore.setState({ sessions: {} });
  useAssistantSidebarStore.setState({ chat: null, pending: null, requested: null });
  useTaskNavigationStore.setState({ enabled: true });
});

const assistantDeskTabs = () =>
  deskTabs(useDesksStore.getState().desks.find((desk) => desk.id === ASSISTANT_DESK_ID)!);

describe("useAssistantTabSweep", () => {
  it("closes a chat tab restored from storage without opening the assistant Desk", () => {
    seedSession({ agents: [["chat", agent()]] });
    const tabId = openChatTab();

    renderHook(() => useAssistantTabSweep());

    expect(deskTabIds()).toEqual([]);
    expect(useDesksStore.getState().activeDeskId).toBe("primary");
    expect(routes.workspace).toEqual([]);
    expect(tabId).toBeTruthy();
  });

  it("closes a chat tab opened later in another Desk and shows the assistant Desk instead", () => {
    seedSession({ agents: [["chat", agent()]] });
    renderHook(() => useAssistantTabSweep());
    // CUSTOM(pm-focus): the sweep is not the user opening the Project Manager.
    vi.useFakeTimers();
    focusChatComposer.mockClear();

    act(() => {
      openChatTab();
    });
    vi.advanceTimersByTime(5000);
    vi.useRealTimers();
    expect(focusChatComposer).not.toHaveBeenCalled();

    expect(useAssistantSidebarStore.getState().chat).toEqual({ serverId: "s1", agentId: "chat" });
    expect(useDesksStore.getState().activeDeskId).toBe(ASSISTANT_DESK_ID);
    expect(assistantDeskTabs().map((tab) => tab.target)).toEqual([
      { kind: "agent", agentId: "chat" },
    ]);
    expect(deskTabs(useDesksStore.getState().desks.find((desk) => desk.id === "primary")!)).toEqual(
      [],
    );
  });

  it("leaves the chat tab inside the assistant Desk alone", () => {
    seedSession({ agents: [["chat", agent()]] });
    renderHook(() => useAssistantTabSweep());

    act(() => {
      useDesksStore.getState().showAssistantChat({
        tab: { ...OWNER, target: { kind: "agent", agentId: "chat" } },
        isChatTab: () => false,
      });
    });

    expect(assistantDeskTabs()).toHaveLength(1);
  });

  it("leaves the Explorer's Projects Assistant mirror tab alone", () => {
    const workspaceKey = "s1:ws";
    const layouts = useWorkspaceLayoutStore.getState();
    const paneId = layouts.showExplorerSidebar(workspaceKey);
    layouts.openTab({
      workspaceKey,
      target: { kind: "projects_assistant" },
      intent: "reveal",
      placement: paneId ? { mode: "pane", paneId } : undefined,
    });

    renderHook(() => useAssistantTabSweep());

    const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey];
    expect(
      collectAllTabs(layout.root).some((tab) => tab.target.kind === "projects_assistant"),
    ).toBe(true);
  });

  it("leaves an archived chat's tab alone", () => {
    seedSession({ agentDetails: [["chat", agent({ archivedAt: new Date() })]] });
    renderHook(() => useAssistantTabSweep());

    const tabId = openChatTab();

    expect(deskTabIds()).toEqual([tabId]);
    expect(routes.workspace).toEqual([]);
  });

  it("finishes a pending open once the session lists the agent", () => {
    renderHook(() => useAssistantTabSweep());
    act(() => {
      useDesksStore.getState().selectAssistantDesk();
      useAssistantSidebarStore.getState().setPending({ serverId: "s1", agentId: "chat" });
      seedSession({ agents: [["chat", agent()]] });
    });

    expect(useAssistantSidebarStore.getState().pending).toBeNull();
    expect(assistantDeskTabs()).toHaveLength(1);
    expect(useDesksStore.getState().activeDeskId).toBe(ASSISTANT_DESK_ID);
  });

  it("does not steal the focus from another Desk when the pending open finishes", () => {
    renderHook(() => useAssistantTabSweep());
    act(() => {
      useDesksStore.getState().selectAssistantDesk();
      useAssistantSidebarStore.getState().setPending({ serverId: "s1", agentId: "chat" });
      seedSession({ agents: [["chat", agent()]] });
    });
    expect(assistantDeskTabs()).toHaveLength(1);

    act(() => {
      useDesksStore.getState().selectDesk("primary");
      useAssistantSidebarStore.getState().setPending({ serverId: "s1", agentId: "chat" });
      seedSession({ agents: [["chat", agent()]] });
    });
    expect(useDesksStore.getState().activeDeskId).toBe("primary");
    expect(useAssistantSidebarStore.getState().pending).toBeNull();
  });
});

describe("newest chat (CUSTOM(assistant-desk-newest))", () => {
  const seedStale = () => {
    useAssistantSidebarStore.setState({ chat: { serverId: "s1", agentId: "old" } });
    seedSession({
      agents: [
        ["old", agent({ id: "old", archivedAt: new Date() })],
        ["new", agent({ id: "new", labels: { ...CHAT, "paseo.replaces-agent": "old" } })],
      ],
    });
    useDesksStore.getState().showAssistantChat({
      tab: { ...OWNER, target: { kind: "agent", agentId: "old" } },
      isChatTab: () => false,
    });
  };
  const targets = () => assistantDeskTabs().map((tab) => tab.target);

  it("retargets a stale chat tab while the Desk is not active", () => {
    seedStale();
    useDesksStore.getState().selectDesk("primary");
    renderHook(() => useAssistantTabSweep());

    expect(targets()).toEqual([{ kind: "agent", agentId: "new" }]);
    expect(useDesksStore.getState().activeDeskId).toBe("primary");
    expect(useAssistantSidebarStore.getState().chat).toEqual({
      serverId: "s1",
      agentId: "new",
    });
  });

  it("keeps the tab while in view and refreshes when the Desk comes into view again", () => {
    seedStale();
    renderHook(() => useAssistantTabSweep());
    // The first evaluation after start forces, so the tab already follows.
    expect(targets()).toEqual([{ kind: "agent", agentId: "new" }]);

    act(() => {
      useDesksStore.getState().selectDesk("primary");
      useDesksStore.getState().showAssistantChat({
        tab: { ...OWNER, target: { kind: "agent", agentId: "old" } },
        isChatTab: () => true,
        select: false,
      });
    });
    // Not in view: the refresh retargets right away.
    expect(targets()).toEqual([{ kind: "agent", agentId: "new" }]);

    act(() => {
      useDesksStore.getState().selectDesk(ASSISTANT_DESK_ID);
    });
    expect(useDesksStore.getState().activeDeskId).toBe(ASSISTANT_DESK_ID);

    // While in view a stale tab is left alone.
    act(() => {
      useDesksStore.getState().showAssistantChat({
        tab: { ...OWNER, target: { kind: "agent", agentId: "old" } },
        isChatTab: () => true,
      });
    });
    expect(targets()).toEqual([{ kind: "agent", agentId: "old" }]);

    act(() => {
      useDesksStore.getState().selectDesk("primary");
    });
    expect(targets()).toEqual([{ kind: "agent", agentId: "new" }]);
  });

  it("forces a refresh when the Desk comes into view with a stale tab", () => {
    seedStale();
    renderHook(() => useAssistantTabSweep());
    // Sweep ran with the Desk in view and force: already new. Make it stale while in view.
    act(() => {
      useDesksStore.getState().showAssistantChat({
        tab: { ...OWNER, target: { kind: "agent", agentId: "old" } },
        isChatTab: () => true,
      });
    });
    expect(targets()).toEqual([{ kind: "agent", agentId: "old" }]);
    act(() => {
      useDesksStore.getState().selectDesk("primary");
      useDesksStore.getState().selectDesk(ASSISTANT_DESK_ID);
    });
    expect(targets()).toEqual([{ kind: "agent", agentId: "new" }]);
  });
});

// CUSTOM(pm-sidebar)
describe("the sidebar's requested chat", () => {
  it("lets go of the requested chat once the session lists it", () => {
    useAssistantSidebarStore.setState({
      chat: { serverId: "s1", agentId: "chat" },
      requested: { serverId: "s1", agentId: "chat" },
    });
    seedSession({ agents: [] });
    renderHook(() => useAssistantTabSweep());
    expect(useAssistantSidebarStore.getState().requested).toEqual({
      serverId: "s1",
      agentId: "chat",
    });

    act(() => seedSession({ agents: [["chat", agent()]] }));

    expect(useAssistantSidebarStore.getState().requested).toBeNull();
    expect(useAssistantSidebarStore.getState().chat).toEqual({ serverId: "s1", agentId: "chat" });
  });
});
