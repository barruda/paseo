// CUSTOM(assistant-desk)
import { beforeEach, describe, expect, it } from "vitest";
import {
  activeDesk,
  ASSISTANT_DESK_ID,
  deskTabs,
  initialDesks,
  useDesksStore,
  type DeskTab,
} from "@/task-navigation/desks-store";

const chatTab = (agentId: string, workspaceId = "ws") => ({
  serverId: "s1",
  workspaceId,
  target: { kind: "agent" as const, agentId },
});
const isChat = (ids: string[]) => (tab: DeskTab) =>
  tab.target.kind === "agent" && ids.includes(tab.target.agentId);
const assistantDesk = () =>
  useDesksStore.getState().desks.find((desk) => desk.id === ASSISTANT_DESK_ID);

beforeEach(() => {
  useDesksStore.setState({ desks: initialDesks(), activeDeskId: "primary", initialized: true });
});

describe("showAssistantChat", () => {
  it("creates the assistant Desk when missing and selects it", () => {
    expect(assistantDesk()).toBeUndefined();
    useDesksStore.getState().showAssistantChat({ tab: chatTab("a"), isChatTab: isChat(["a"]) });

    expect(assistantDesk()?.name).toBe("Projects Assistant");
    expect(useDesksStore.getState().activeDeskId).toBe(ASSISTANT_DESK_ID);
    expect(deskTabs(assistantDesk()!).map((tab) => tab.target)).toEqual([
      { kind: "agent", agentId: "a" },
    ]);
    // Opened as a kept tab, not a preview.
    expect(assistantDesk()!.previewTabId).toBeNull();
  });

  it("recreates the Desk after the user deleted it", () => {
    const store = useDesksStore.getState();
    store.showAssistantChat({ tab: chatTab("a"), isChatTab: isChat(["a"]) });
    store.deleteDesk(ASSISTANT_DESK_ID);
    expect(assistantDesk()).toBeUndefined();
    store.showAssistantChat({ tab: chatTab("a"), isChatTab: isChat(["a"]) });
    expect(deskTabs(assistantDesk()!)).toHaveLength(1);
  });

  it("reuses the tab the same chat already has", () => {
    const store = useDesksStore.getState();
    store.showAssistantChat({ tab: chatTab("a"), isChatTab: isChat(["a"]) });
    const id = deskTabs(assistantDesk()!)[0]!.id;
    store.selectDesk("primary");
    store.showAssistantChat({ tab: chatTab("a"), isChatTab: isChat(["a"]) });

    expect(deskTabs(assistantDesk()!).map((tab) => tab.id)).toEqual([id]);
    expect(useDesksStore.getState().activeDeskId).toBe(ASSISTANT_DESK_ID);
  });

  it("retargets an older chat tab in place and leaves exactly one chat tab", () => {
    const store = useDesksStore.getState();
    store.showAssistantChat({ tab: chatTab("old1"), isChatTab: isChat(["old1"]) });
    store.openTab(chatTab("old2"), true);
    store.openTab({ ...chatTab("x"), target: { kind: "file", path: "a.ts" } }, true);
    expect(deskTabs(assistantDesk()!)).toHaveLength(3);

    store.showAssistantChat({
      tab: chatTab("new", "ws2"),
      isChatTab: isChat(["old1", "old2", "new"]),
    });

    const tabs = deskTabs(assistantDesk()!);
    expect(tabs.filter(isChat(["old1", "old2", "new"]))).toHaveLength(1);
    const chat = tabs.find(isChat(["new"]))!;
    expect(chat.workspaceId).toBe("ws2");
    expect(tabs).toHaveLength(2);
    expect(tabs.some((tab) => tab.target.kind === "file")).toBe(true);
    const desk = activeDesk(useDesksStore.getState());
    expect(deskTabs(desk).find((tab) => tab.id === chat.id)).toBeTruthy();
  });
});
