/**
 * @vitest-environment jsdom
 */
// CUSTOM(assistant-sidebar)
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { assistantSidebarPanelRegistration } from "./panel";
import { ASSISTANT_CHAT_LABEL } from "./model";
import { useAssistantSidebarStore } from "./store";

const CHAT = { [ASSISTANT_CHAT_LABEL]: "true" };

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

function seedSession(agents: [string, Agent][], agentDetails: [string, Agent][] = []): void {
  useSessionStore.setState({
    sessions: {
      s1: {
        serverId: "s1",
        agents: new Map(agents),
        agentDetails: new Map(agentDetails),
        hasHydratedAgents: true,
      } as unknown as SessionState,
    },
  });
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
  useSessionStore.setState({ sessions: {} });
  useAssistantSidebarStore.setState({ chat: null, requestSeq: 0, handledSeq: 0 });
});

afterEach(cleanup);

describe("Projects Assistant sidebar panel", () => {
  it("shows the live chat the store resolves, through a pane pointed at that agent", () => {
    seedSession([["chat", agent()]]);
    renderPanel();
    expect(screen.getByTestId("agent-panel").getAttribute("data-agent")).toBe("chat");
  });

  it("keeps showing an archived chat when no live chat exists", () => {
    seedSession([], [["old", agent({ id: "old", archivedAt: new Date() })]]);
    useAssistantSidebarStore.getState().setChat({ serverId: "s1", agentId: "old" });
    renderPanel();
    expect(screen.getByTestId("agent-panel").getAttribute("data-agent")).toBe("old");
  });

  it("points the user back to the board when there is no chat at all", () => {
    renderPanel();
    expect(screen.queryByTestId("agent-panel")).toBeNull();
    expect(screen.getByText(/Open one from Power Workboard/)).toBeTruthy();
  });

  it("remembers the resolved chat so the next start shows it straight away", () => {
    seedSession([["chat", agent()]]);
    renderPanel();
    expect(useAssistantSidebarStore.getState().chat).toEqual({ serverId: "s1", agentId: "chat" });
  });
});
