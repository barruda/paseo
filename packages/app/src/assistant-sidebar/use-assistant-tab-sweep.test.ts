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
vi.mock("@/chat-esc-focus/registry", () => ({ focusChatComposer: () => true }));
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
  useAssistantSidebarStore.setState({ chat: null, pending: null });
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

    act(() => {
      openChatTab();
    });

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
