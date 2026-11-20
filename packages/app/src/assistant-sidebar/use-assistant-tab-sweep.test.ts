/**
 * @vitest-environment jsdom
 */
// CUSTOM(assistant-sidebar)
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const routes = vi.hoisted(() => ({ workspace: [] as string[] }));
vi.mock("@/navigation/workspace-route-navigation", () => ({
  navigateToHostWorkspaceRoute: (route: string) => routes.workspace.push(route),
}));
vi.mock("@/stores/navigation-active-workspace-store", () => ({
  getLastWorkspaceSelection: () => null,
}));

import { useSessionStore, type Agent, type SessionState } from "@/stores/session-store";
import { useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { activeDesk, deskTabs, initialDesks, useDesksStore } from "@/task-navigation/desks-store";
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
  useAssistantSidebarStore.setState({ chat: null, requestSeq: 0, handledSeq: 0 });
});

describe("useAssistantTabSweep", () => {
  it("closes a chat tab restored from storage without revealing the sidebar", () => {
    seedSession({ agents: [["chat", agent()]] });
    const tabId = openChatTab();

    renderHook(() => useAssistantTabSweep());

    expect(deskTabIds()).toEqual([]);
    expect(useAssistantSidebarStore.getState().requestSeq).toBe(0);
    expect(routes.workspace).toEqual([]);
    expect(tabId).toBeTruthy();
  });

  it("closes a chat tab opened later and shows the sidebar chat instead", () => {
    seedSession({ agents: [["chat", agent()]] });
    renderHook(() => useAssistantTabSweep());

    act(() => {
      openChatTab();
    });

    expect(deskTabIds()).toEqual([]);
    expect(routes.workspace).toEqual(["/h/s1/workspace/ws"]);
    expect(useAssistantSidebarStore.getState()).toMatchObject({
      chat: { serverId: "s1", agentId: "chat" },
      requestSeq: 1,
    });
  });

  it("leaves an archived chat's tab alone", () => {
    seedSession({ agentDetails: [["chat", agent({ archivedAt: new Date() })]] });
    renderHook(() => useAssistantTabSweep());

    const tabId = openChatTab();

    expect(deskTabIds()).toEqual([tabId]);
    expect(useAssistantSidebarStore.getState().requestSeq).toBe(0);
    expect(routes.workspace).toEqual([]);
  });
});
