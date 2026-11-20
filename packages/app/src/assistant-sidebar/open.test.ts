// CUSTOM(assistant-sidebar)
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

import { AGENT_REPLACES_LABEL } from "@/task-navigation/agent-successor";
import { useDeskWorkboardStore } from "@/task-navigation/desk-workboard-store";
import { useSessionStore, type Agent, type SessionState } from "@/stores/session-store";
import { ASSISTANT_CHAT_LABEL } from "./model";
import { currentAssistantChat, isAssistantChatInSession, openAssistantSidebar } from "./open";
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
  useAssistantSidebarStore.setState({
    chat: null,
    requestSeq: 0,
    handledSeq: 0,
    focusComposer: false,
  });
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

describe("openAssistantSidebar", () => {
  it("remembers the chat, shows the last workspace, and drops the board chip", () => {
    routes.last = { serverId: "s1", workspaceId: "ws" };
    useDeskWorkboardStore.setState({ selected: "power-workboard" });

    const route = openAssistantSidebar({ chat: { serverId: "s1", agentId: "chat" } });

    expect(route).toBe("/h/s1/workspace/ws");
    expect(routes.workspace).toEqual(["/h/s1/workspace/ws"]);
    expect(useAssistantSidebarStore.getState()).toMatchObject({
      chat: { serverId: "s1", agentId: "chat" },
      requestSeq: 1,
      focusComposer: true,
    });
    expect(useDeskWorkboardStore.getState().selected).toBeNull();
  });

  it("falls back to the chat's own workspace when no workspace was shown yet", () => {
    seedSession({ agents: [["chat", agent({ labels: CHAT, workspaceId: "ws-chat" })]] });

    expect(openAssistantSidebar({ chat: { serverId: "s1", agentId: "chat" } })).toBe(
      "/h/s1/workspace/ws-chat",
    );
    expect(routes.workspace).toEqual(["/h/s1/workspace/ws-chat"]);
  });

  it("only remembers the chat when there is no workspace to show it in", () => {
    expect(openAssistantSidebar({ chat: { serverId: "s1", agentId: "chat" } })).toBe("");
    expect(routes.workspace).toEqual([]);
    expect(useAssistantSidebarStore.getState()).toMatchObject({
      chat: { serverId: "s1", agentId: "chat" },
      requestSeq: 0,
    });
  });
});
