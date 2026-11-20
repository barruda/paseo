/**
 * @vitest-environment jsdom
 */
// CUSTOM(assistant-desk)
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openAssistantDesk = vi.hoisted(() => vi.fn());
vi.mock("./open", () => ({ openAssistantDesk }));

vi.mock("@/panels/agent-panel", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react");
  const { usePaneContext } =
    await vi.importActual<typeof import("@/panels/pane-context")>("@/panels/pane-context");
  return {
    AgentConversationPanel: () => {
      const pane = usePaneContext();
      return ReactModule.createElement("div", {
        "data-testid": "agent-panel",
        "data-agent": pane.target.kind === "agent" ? pane.target.agentId : "",
      });
    },
  };
});

import { PaneProvider, type PaneContextValue } from "@/panels/pane-context";
import { useSessionStore, type Agent, type SessionState } from "@/stores/session-store";
import { initialDesks, useDesksStore, type DeskTab } from "@/task-navigation/desks-store";
import { assistantSidebarPanelRegistration } from "./panel";
import { ASSISTANT_CHAT_LABEL } from "./model";
import { useAssistantSidebarStore } from "./store";

const CHAT = { [ASSISTANT_CHAT_LABEL]: "true" };
const OWNER = { serverId: "s1", workspaceId: "ws" };
const chatTab = (agentId: string) => ({ ...OWNER, target: { kind: "agent" as const, agentId } });
const isChat = (tab: DeskTab) => tab.target.kind === "agent";

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

function seedSession(agents: [string, Agent][]): void {
  useSessionStore.setState({
    sessions: {
      s1: {
        serverId: "s1",
        agents: new Map(agents),
        agentDetails: new Map(),
        hasHydratedAgents: true,
      } as unknown as SessionState,
    },
  });
}

function showChat(agentId: string): void {
  useDesksStore.getState().showAssistantChat({ tab: chatTab(agentId), isChatTab: isChat });
}

const paneContext: PaneContextValue = {
  serverId: "s1",
  workspaceId: "ws",
  host: "explorer",
  tabId: "projects-assistant",
  target: { kind: "projects_assistant" },
  openTab: () => {},
  openPreferredTarget: () => {},
  closeCurrentTab: () => {},
  retargetCurrentTab: () => {},
  setCurrentTabState: () => {},
  openFileInWorkspace: () => {},
  openImportSheet: () => {},
};

const Panel = assistantSidebarPanelRegistration.component;

function renderPanel() {
  return render(
    <PaneProvider value={paneContext}>
      <Panel />
    </PaneProvider>,
  );
}

beforeEach(() => {
  openAssistantDesk.mockClear();
  useSessionStore.setState({ sessions: {} });
  useAssistantSidebarStore.setState({ chat: null, pending: null });
  useDesksStore.setState({ desks: initialDesks(), activeDeskId: "primary", initialized: true });
});

afterEach(cleanup);

describe("Projects Assistant sidebar panel", () => {
  it("shows the chat the assistant Desk has in front, through a pane pointed at that agent", () => {
    seedSession([["chat", agent()]]);
    showChat("chat");
    renderPanel();
    expect(screen.getByTestId("agent-panel").getAttribute("data-agent")).toBe("chat");
  });

  it("follows the Desk when its chat changes", () => {
    seedSession([
      ["chat", agent()],
      ["next", agent({ id: "next" })],
    ]);
    showChat("chat");
    renderPanel();

    act(() => showChat("next"));

    expect(screen.getByTestId("agent-panel").getAttribute("data-agent")).toBe("next");
  });

  it("points the user to the Desk when the Desk has no chat", () => {
    useDesksStore.getState().selectAssistantDesk();
    renderPanel();
    expect(screen.queryByTestId("agent-panel")).toBeNull();
    expect(screen.getByText(/has no chat open/)).toBeTruthy();
  });

  it("opens the Desk from the empty state", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("projects-assistant-open-desk"));
    expect(openAssistantDesk).toHaveBeenCalledWith({ chat: null });
  });

  it("remembers the Desk's chat so the next start shows it straight away", () => {
    seedSession([["chat", agent()]]);
    showChat("chat");
    renderPanel();
    expect(useAssistantSidebarStore.getState().chat).toEqual({ serverId: "s1", agentId: "chat" });
  });
});
