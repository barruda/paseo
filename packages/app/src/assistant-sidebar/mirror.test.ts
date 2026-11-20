// CUSTOM(assistant-desk)
import { beforeEach, describe, expect, it } from "vitest";
import {
  ASSISTANT_DESK_ID,
  initialDesks,
  useDesksStore,
  type DeskTab,
} from "@/task-navigation/desks-store";
import { assistantDeskChat } from "./mirror";

const OWNER = { serverId: "s1", workspaceId: "ws" };
const chatTab = (agentId: string) => ({ ...OWNER, target: { kind: "agent" as const, agentId } });
const isChat = (tab: DeskTab) => tab.target.kind === "agent";

function showChat(agentId: string): void {
  useDesksStore.getState().showAssistantChat({ tab: chatTab(agentId), isChatTab: isChat });
}

function openFile(path: string): void {
  useDesksStore.getState().openTab({ ...OWNER, target: { kind: "file", path } }, true);
}

function setAssistantDeskAgentTabId(agentTabId: string | undefined): void {
  useDesksStore.setState((state) => ({
    desks: state.desks.map((desk) =>
      desk.id === ASSISTANT_DESK_ID ? { ...desk, agentTabId } : desk,
    ),
  }));
}

beforeEach(() => {
  useDesksStore.setState({ desks: initialDesks(), activeDeskId: "primary", initialized: true });
});

describe("assistantDeskChat", () => {
  it("is null while the assistant Desk does not exist", () => {
    expect(assistantDeskChat(useDesksStore.getState().desks)).toBeNull();
  });

  it("is null while the assistant Desk has no tab", () => {
    useDesksStore.getState().selectAssistantDesk();
    expect(assistantDeskChat(useDesksStore.getState().desks)).toBeNull();
  });

  it("shows the focused agent tab", () => {
    showChat("chat");
    expect(assistantDeskChat(useDesksStore.getState().desks)).toEqual({
      serverId: "s1",
      agentId: "chat",
    });
  });

  it("keeps showing the chat when another tab of the Desk is in front", () => {
    showChat("chat");
    openFile("a.ts");
    expect(assistantDeskChat(useDesksStore.getState().desks)).toEqual({
      serverId: "s1",
      agentId: "chat",
    });
  });

  it("finds the chat when the Desk forgot which agent tab it focused", () => {
    showChat("chat");
    openFile("a.ts");
    setAssistantDeskAgentTabId(undefined);
    expect(assistantDeskChat(useDesksStore.getState().desks)).toEqual({
      serverId: "s1",
      agentId: "chat",
    });
  });

  it("ignores agent tabs of other Desks", () => {
    showChat("chat");
    useDesksStore.getState().selectDesk("primary");
    useDesksStore.getState().openTab(chatTab("other"), true);
    expect(assistantDeskChat(useDesksStore.getState().desks)).toEqual({
      serverId: "s1",
      agentId: "chat",
    });
  });
});
