// CUSTOM(assistant-desk)
import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/chat-esc-focus/registry", () => ({ focusChatComposer: () => true }));

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
import { currentAssistantChat, isAssistantChatInSession, openAssistantDesk } from "./open";
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
  useAssistantSidebarStore.setState({ chat: null, pending: null });
  useTaskNavigationStore.setState({ enabled: true });
  useDesksStore.setState({ desks: initialDesks(), activeDeskId: "primary", initialized: true });
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
