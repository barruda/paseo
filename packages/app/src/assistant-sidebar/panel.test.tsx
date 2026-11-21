/**
 * @vitest-environment jsdom
 */
// CUSTOM(assistant-desk), CUSTOM(pm-sidebar)
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openAssistantDesk = vi.hoisted(() => vi.fn());
const openAssistantSidebar = vi.hoisted(() => vi.fn());
vi.mock("./open", () => ({ openAssistantDesk, openAssistantSidebar }));

const prepareAgentTimeline = vi.hoisted(() => vi.fn(() => Promise.resolve()));
vi.mock("@/runtime/host-runtime", () => ({
  getHostRuntimeStore: () => ({ prepareAgentTimeline }),
}));

vi.mock("@/panels/agent-panel", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react");
  const { usePaneContext } =
    await vi.importActual<typeof import("@/panels/pane-context")>("@/panels/pane-context");
  const { useSecondaryComposerOptions } = await vi.importActual<
    typeof import("@/composer/esc-focus-target")
  >("@/composer/esc-focus-target");
  return {
    AgentConversationPanel: () => {
      const pane = usePaneContext();
      const composer = useSecondaryComposerOptions();
      return ReactModule.createElement("div", {
        "data-testid": "agent-panel",
        "data-agent": pane.target.kind === "agent" ? pane.target.agentId : "",
        "data-secondary": String(composer.secondary),
        "data-autofocus": String(composer.autoFocus),
        "data-interrupts-on-esc": String(composer.interruptsOnEsc),
      });
    },
  };
});

// CUSTOM(pm-sidebar-decisions): plugin views stand in for Power Workboard's decisions list.
const sidebarViews = vi.hoisted(() => ({ list: [] as unknown[] }));
vi.mock("./plugin-views", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react");
  return {
    useAssistantSidebarViews: () => sidebarViews.list,
    AssistantSidebarViewBadge: () =>
      ReactModule.createElement("span", { "data-testid": "view-badge" }, "3"),
    AssistantSidebarViewBody: ({ onClose }: { onClose: () => void }) =>
      ReactModule.createElement(
        "button",
        { "data-testid": "view-body", type: "button", onClick: onClose },
        "decisions",
      ),
  };
});

import { PaneProvider, type PaneContextValue } from "@/panels/pane-context";
import { useSessionStore, type Agent, type SessionState } from "@/stores/session-store";
import { initialDesks, useDesksStore, type DeskTab } from "@/task-navigation/desks-store";
import { useDeskWorkboardStore } from "@/task-navigation/desk-workboard-store";
import { useTaskNavigationStore } from "@/task-navigation/store";
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
  openAssistantSidebar.mockClear();
  useTaskNavigationStore.setState({ enabled: true });
  useDeskWorkboardStore.setState({ selected: null });
  useSessionStore.setState({ sessions: {} });
  useAssistantSidebarStore.setState({ chat: null, pending: null, requested: null });
  useDesksStore.setState({ desks: initialDesks(), activeDeskId: "primary", initialized: true });
  sidebarViews.list = [];
});

afterEach(cleanup);

describe("Projects Assistant sidebar panel", () => {
  it("registers the chat it shows with the viewed-timeline sync, so its history loads", () => {
    seedSession([["chat", agent()]]);
    const replaceVisibleAgentIds = vi.fn();
    const session = useSessionStore.getState().sessions.s1!;
    useSessionStore.setState({
      sessions: {
        s1: {
          ...session,
          viewedTimelineSync: { replaceVisibleAgentIds },
        } as unknown as SessionState,
      },
    });
    useAssistantSidebarStore.setState({ chat: { serverId: "s1", agentId: "chat" } });
    const view = renderPanel();
    const source = replaceVisibleAgentIds.mock.calls[0]?.[0];
    expect(replaceVisibleAgentIds).toHaveBeenCalledWith(source, ["chat"]);
    expect(prepareAgentTimeline).toHaveBeenCalledWith("s1", "chat");
    view.unmount();
    expect(replaceVisibleAgentIds).toHaveBeenLastCalledWith(source, []);
  });

  // CUSTOM(chat-esc-focus), CUSTOM(pm-focus)
  it("renders its composer as a side panel's that never autofocuses nor stops on Esc Esc", () => {
    seedSession([["chat", agent()]]);
    useAssistantSidebarStore.setState({ chat: { serverId: "s1", agentId: "chat" } });
    renderPanel();
    const panel = screen.getByTestId("agent-panel");
    expect(panel.getAttribute("data-secondary")).toBe("true");
    expect(panel.getAttribute("data-autofocus")).toBe("false");
    expect(panel.getAttribute("data-interrupts-on-esc")).toBe("false");
  });

  it("shows the remembered chat through a pane pointed at that agent", () => {
    seedSession([["chat", agent()]]);
    useAssistantSidebarStore.setState({ chat: { serverId: "s1", agentId: "chat" } });
    renderPanel();
    expect(screen.getByTestId("agent-panel").getAttribute("data-agent")).toBe("chat");
  });

  it("shows the chat it was asked for, not a hidden Desk's", () => {
    seedSession([
      ["desk-chat", agent({ id: "desk-chat" })],
      ["asked", agent({ id: "asked" })],
    ]);
    showChat("desk-chat");
    useDesksStore.getState().selectDesk("primary");
    useAssistantSidebarStore.setState({ chat: { serverId: "s1", agentId: "asked" } });
    renderPanel();

    expect(screen.getByTestId("agent-panel").getAttribute("data-agent")).toBe("asked");
    // The hidden Desk does not overwrite the remembered chat.
    expect(useAssistantSidebarStore.getState().chat).toEqual({ serverId: "s1", agentId: "asked" });
  });

  it("shows a chat the session does not list yet instead of the newest live one", () => {
    seedSession([["old", agent({ id: "old" })]]);
    useAssistantSidebarStore.setState({
      chat: { serverId: "s1", agentId: "new" },
      requested: { serverId: "s1", agentId: "new" },
    });
    renderPanel();
    expect(screen.getByTestId("agent-panel").getAttribute("data-agent")).toBe("new");
  });

  it("follows the remembered chat when it changes", async () => {
    seedSession([
      ["chat", agent()],
      ["next", agent({ id: "next" })],
    ]);
    useAssistantSidebarStore.setState({ chat: { serverId: "s1", agentId: "chat" } });
    renderPanel();

    await act(async () =>
      useAssistantSidebarStore.getState().setChat({ serverId: "s1", agentId: "next" }),
    );

    expect(screen.getByTestId("agent-panel").getAttribute("data-agent")).toBe("next");
  });

  it("while the Project Manager Desk is on screen, says so instead of a second composer", async () => {
    seedSession([["chat", agent()]]);
    useAssistantSidebarStore.setState({ chat: { serverId: "s1", agentId: "chat" } });
    showChat("chat");
    renderPanel();

    expect(screen.queryByTestId("agent-panel")).toBeNull();
    expect(screen.getByText(/open in the main area/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("projects-assistant-show-here"));
    expect(openAssistantSidebar).toHaveBeenCalledWith({
      chat: { serverId: "s1", agentId: "chat" },
    });

    // The board chip covers the Desk: the chat is back in the sidebar.
    await act(async () => useDeskWorkboardStore.setState({ selected: "power-workboard" }));
    expect(screen.getByTestId("agent-panel").getAttribute("data-agent")).toBe("chat");
  });

  it("asks to open the main area when there is no chat at all", () => {
    renderPanel();
    expect(screen.queryByTestId("agent-panel")).toBeNull();
    expect(screen.getByText(/No Project Manager chat yet/)).toBeTruthy();
  });

  it("opens the Desk from the empty state", () => {
    renderPanel();
    fireEvent.click(screen.getByTestId("projects-assistant-open-desk"));
    expect(openAssistantDesk).toHaveBeenCalledWith({ chat: null });
  });

  // CUSTOM(pm-sidebar): the right sidebar is the chat's default place; the Desk may not exist.
  it("shows the remembered chat without a Project Manager Desk", () => {
    seedSession([["chat", agent()]]);
    useAssistantSidebarStore.setState({ chat: { serverId: "s1", agentId: "chat" } });
    renderPanel();
    expect(screen.getByTestId("agent-panel").getAttribute("data-agent")).toBe("chat");
    expect(openAssistantDesk).not.toHaveBeenCalled();
  });

  it("shows the newest live chat when none is remembered", () => {
    seedSession([["live", agent({ id: "live" })]]);
    renderPanel();
    expect(screen.getByTestId("agent-panel").getAttribute("data-agent")).toBe("live");
  });

  it("opens the chat in the main area only from its link", () => {
    seedSession([["chat", agent()]]);
    useAssistantSidebarStore.setState({ chat: { serverId: "s1", agentId: "chat" } });
    renderPanel();
    expect(openAssistantDesk).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("projects-assistant-open-main"));
    expect(openAssistantDesk).toHaveBeenCalledWith({ chat: { serverId: "s1", agentId: "chat" } });
  });

  it("falls back to the Desk's chat when there is no other, and remembers it", () => {
    showChat("chat");
    useDesksStore.getState().selectDesk("primary");
    renderPanel();
    expect(screen.getByTestId("agent-panel").getAttribute("data-agent")).toBe("chat");
    expect(useAssistantSidebarStore.getState().chat).toEqual({ serverId: "s1", agentId: "chat" });
  });
});

// CUSTOM(pm-sidebar-decisions)
describe("Projects Assistant sidebar panel views", () => {
  const VIEW_KEY = "power-workboard/pm-decisions";
  const openButton = `projects-assistant-view-${VIEW_KEY}`;

  function withDecisions(): void {
    sidebarViews.list = [{ key: VIEW_KEY, title: "Decisões" }];
    seedSession([["chat", agent()]]);
    useAssistantSidebarStore.setState({ chat: { serverId: "s1", agentId: "chat" } });
  }

  it("has no view button when no plugin adds a view", () => {
    seedSession([["chat", agent()]]);
    useAssistantSidebarStore.setState({ chat: { serverId: "s1", agentId: "chat" } });
    renderPanel();
    expect(screen.queryByTestId(openButton)).toBeNull();
    expect(screen.queryByTestId("projects-assistant-back-to-chat")).toBeNull();
  });

  it("puts the view's button, with its badge, next to Open in main area", () => {
    withDecisions();
    renderPanel();
    const button = screen.getByTestId(openButton);
    expect(button.textContent).toContain("Decisões");
    expect(screen.getByTestId("view-badge").textContent).toBe("3");
    expect(screen.getByTestId("projects-assistant-open-main")).toBeTruthy();
  });

  it("opens the view over the chat and goes back with the arrow, keeping the chat mounted", async () => {
    withDecisions();
    renderPanel();
    const chatNode = screen.getByTestId("agent-panel");
    const desksBefore = useDesksStore.getState();

    await act(async () => fireEvent.click(screen.getByTestId(openButton)));
    expect(screen.getByTestId("view-body")).toBeTruthy();
    expect(screen.getByTestId("projects-assistant-back-to-chat").textContent).toContain("Decisões");
    expect(screen.queryByTestId(openButton)).toBeNull();
    // The chat stays mounted under the view, so its draft, scroll and focus survive.
    expect(screen.getByTestId("agent-panel")).toBe(chatNode);
    // Only the tab changed: no Desk, no other tab.
    expect(openAssistantDesk).not.toHaveBeenCalled();
    expect(openAssistantSidebar).not.toHaveBeenCalled();
    expect(useDesksStore.getState().activeDeskId).toBe(desksBefore.activeDeskId);
    expect(useDesksStore.getState().desks).toBe(desksBefore.desks);

    await act(async () => fireEvent.click(screen.getByTestId("projects-assistant-back-to-chat")));
    expect(screen.queryByTestId("view-body")).toBeNull();
    expect(screen.queryByTestId("projects-assistant-back-to-chat")).toBeNull();
    expect(screen.getByTestId(openButton)).toBeTruthy();
    expect(screen.getByTestId("agent-panel")).toBe(chatNode);
  });

  it("lets the view close itself back to the chat", async () => {
    withDecisions();
    renderPanel();
    await act(async () => fireEvent.click(screen.getByTestId(openButton)));
    await act(async () => fireEvent.click(screen.getByTestId("view-body")));
    expect(screen.queryByTestId("view-body")).toBeNull();
  });

  it("falls back to the chat when the view's plugin goes away", async () => {
    withDecisions();
    const view = renderPanel();
    await act(async () => fireEvent.click(screen.getByTestId(openButton)));
    sidebarViews.list = [];
    view.rerender(
      <PaneProvider value={paneContext}>
        <Panel />
      </PaneProvider>,
    );
    expect(screen.queryByTestId("view-body")).toBeNull();
    expect(screen.getByTestId("agent-panel")).toBeTruthy();
  });
});
