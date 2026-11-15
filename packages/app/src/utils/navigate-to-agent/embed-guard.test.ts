import { afterEach, describe, expect, it, vi } from "vitest";

const { routerNavigate, navigateToWorkspaceMock } = vi.hoisted(() => ({
  routerNavigate: vi.fn(),
  navigateToWorkspaceMock: vi.fn(() => "/workspace"),
}));

vi.mock("expo-router", () => ({ router: { navigate: routerNavigate } }));
vi.mock("@/embed/embed-mode", () => ({ isEmbedMode: () => true }));
vi.mock("@/stores/navigation-active-workspace-store", () => ({
  navigateToWorkspace: navigateToWorkspaceMock,
}));
vi.mock("@/stores/session-store", () => ({
  useSessionStore: { getState: () => ({ sessions: {} }) },
}));

import { navigateToAgent } from "./index";

describe("navigateToAgent in embed mode", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("opens the paseo:// deep link and does not route", () => {
    const open = vi.fn();
    vi.stubGlobal("window", { open });

    const result = navigateToAgent({ serverId: "srv-1", agentId: "agent-1", workspaceId: "ws-1" });

    expect(open).toHaveBeenCalledWith("paseo://h/srv-1/agent/agent-1");
    expect(result).toBe("paseo://h/srv-1/agent/agent-1");
    expect(routerNavigate).not.toHaveBeenCalled();
    expect(navigateToWorkspaceMock).not.toHaveBeenCalled();
  });
});
