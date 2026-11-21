// CUSTOM(assistant-desk), CUSTOM(pm-sidebar)
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isAssistantChatInSession: vi.fn(() => false),
  openAssistantSidebar: vi.fn(() => "/h/s1/workspace/ws"),
  navigateToWorkspace: vi.fn(() => "/h/s1/workspace/ws"),
}));

vi.mock("@/assistant-sidebar/open", () => ({
  isAssistantChatInSession: mocks.isAssistantChatInSession,
  openAssistantSidebar: mocks.openAssistantSidebar,
}));
vi.mock("@/stores/navigation-active-workspace-store", () => ({
  navigateToWorkspace: mocks.navigateToWorkspace,
}));

import { useSessionStore, type Agent, type SessionState } from "@/stores/session-store";
import { navigateToAgent } from "./index";

function seedAgent(agent: Partial<Agent>): void {
  useSessionStore.setState({
    sessions: {
      s1: {
        serverId: "s1",
        agents: new Map([["chat", agent as Agent]]),
        agentDetails: new Map(),
        hasHydratedAgents: true,
      } as unknown as SessionState,
    },
  });
}

beforeEach(() => {
  useSessionStore.setState({ sessions: {} });
  mocks.isAssistantChatInSession.mockReset().mockReturnValue(false);
  mocks.openAssistantSidebar.mockClear();
  mocks.navigateToWorkspace.mockClear();
});

describe("navigateToAgent with the Projects Assistant", () => {
  it("sends a live chat the session knows to the right sidebar, whatever route it was asked for", () => {
    mocks.isAssistantChatInSession.mockReturnValue(true);

    const route = navigateToAgent({ serverId: "s1", agentId: "chat", pin: true });

    expect(route).toBe("/h/s1/workspace/ws");
    expect(mocks.openAssistantSidebar).toHaveBeenCalledWith({
      chat: { serverId: "s1", agentId: "chat" },
    });
    expect(mocks.navigateToWorkspace).not.toHaveBeenCalled();
  });

  it("trusts the flag the plugin passes for a chat the session does not list yet", () => {
    navigateToAgent({ serverId: "s1", agentId: "brand-new", assistantSidebar: true });

    expect(mocks.openAssistantSidebar).toHaveBeenCalledWith({
      chat: { serverId: "s1", agentId: "brand-new" },
    });
  });

  it("falls back to ordinary navigation when Tasks mode is off", () => {
    seedAgent({ id: "chat", workspaceId: "ws" });
    mocks.isAssistantChatInSession.mockReturnValue(true);
    mocks.openAssistantSidebar.mockReturnValueOnce(null as unknown as string);

    navigateToAgent({ serverId: "s1", agentId: "chat" });

    expect(mocks.navigateToWorkspace).toHaveBeenCalledWith({
      serverId: "s1",
      workspaceId: "ws",
      target: { kind: "agent", agentId: "chat" },
      pin: undefined,
    });
  });

  it("opens an ordinary agent tab for an archived chat", () => {
    seedAgent({ id: "chat", workspaceId: "ws" });

    navigateToAgent({ serverId: "s1", agentId: "chat" });

    expect(mocks.openAssistantSidebar).not.toHaveBeenCalled();
    expect(mocks.navigateToWorkspace).toHaveBeenCalledWith({
      serverId: "s1",
      workspaceId: "ws",
      target: { kind: "agent", agentId: "chat" },
      pin: undefined,
    });
  });
});
