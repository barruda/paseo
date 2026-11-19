// CUSTOM(workboard-inner-pages)
import { describe, expect, it } from "vitest";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import {
  WORKBOARD_PAGES,
  isRestorableTab,
  pageTabForSurface,
  reportTab,
  requestedTab,
  tabRequestKey,
  withPageNavigation,
  workboardPageLabels,
} from "../client/assistant/workboard-pages";
import {
  openDeskSurface,
  showConversation,
  showReport,
  useReportTaskRequest,
} from "../client/assistant/nav";

type Navigation = PluginSurfaceProps["navigation"];

function hostNavigation(extra: Record<string, unknown> = {}) {
  return {
    openAgent() {},
    openWorkspace() {},
    ...extra,
  } as unknown as Navigation;
}

describe("Projects Assistant pages inside the Power Workboard", () => {
  it("lists Assistant, Dashboard, Conversations and Reports in that order", () => {
    expect(WORKBOARD_PAGES.map((page) => page.tab)).toEqual([
      "assistant-chat",
      "dashboard",
      "conversations",
      "reports",
    ]);
    expect(Object.values(workboardPageLabels("en"))).toEqual([
      "Assistant",
      "Dashboard",
      "Conversations",
      "Reports",
    ]);
    expect(workboardPageLabels("pt").reports).toBe("Relatórios");
  });

  it("maps the old surface ids to their tabs", () => {
    expect(pageTabForSurface("projects-assistant-chat")).toBe("assistant-chat");
    expect(pageTabForSurface("projects-dashboard")).toBe("dashboard");
    expect(pageTabForSurface("projects-conversations")).toBe("conversations");
    expect(pageTabForSurface("projects-reports")).toBe("reports");
    expect(pageTabForSurface("power-workboard")).toBeNull();
  });

  it("selects the tab the host asks for and ignores anything else", () => {
    expect(requestedTab({ tab: "reports" })).toBe("reports");
    expect(requestedTab({ tab: "orchestrators" })).toBe("orchestrators");
    // The chat tab opens the chat on mount; asking for it would trap the board there.
    expect(requestedTab({ tab: "assistant-chat" })).toBeNull();
    expect(requestedTab({ tab: "some-orchestrator-id" })).toBeNull();
    expect(requestedTab({})).toBeNull();
    expect(requestedTab(undefined)).toBeNull();
  });

  it("keys a request on its tab and request id", () => {
    expect(tabRequestKey({ tab: "reports" })).toBe("reports");
    expect(tabRequestKey({ tab: "reports", request: "1" })).toBe("reports#1");
    expect(tabRequestKey({ tab: "reports", request: "2" })).toBe("reports#2");
    expect(tabRequestKey({ tab: "assistant-chat", request: "1" })).toBeNull();
    expect(tabRequestKey(undefined)).toBeNull();
  });

  it("reports only tabs worth restoring to the Desk", () => {
    const reported: string[] = [];
    const navigation = hostNavigation({
      setDeskWorkboardTab: (tab: string) => reported.push(tab),
    });
    for (const tab of [
      "board",
      "dashboard",
      "assistant-chat",
      "uuid-1",
      "reports",
    ])
      reportTab(navigation, tab);
    expect(reported).toEqual(["board", "dashboard", "reports"]);
    expect(isRestorableTab("assistant-chat")).toBe(false);
    expect(() => reportTab(hostNavigation(), "board")).not.toThrow();
  });

  it("switches the board's tab from page links, in any host", () => {
    const selected: string[] = [];
    const hostOpened: string[] = [];
    const navigation = withPageNavigation(
      hostNavigation({ openDeskSurface: (id: string) => hostOpened.push(id) }),
      (tab) => selected.push(tab),
    );
    showReport(navigation, "task-1");
    showConversation(navigation, "agent-1", "task-1");
    expect(openDeskSurface(navigation, "elsewhere")).toBe(true);
    expect(selected).toEqual(["reports", "conversations"]);
    expect(hostOpened).toEqual(["elsewhere"]);

    // The workspace tab and the sidebar route have no openDeskSurface of their own.
    const plainSelected: string[] = [];
    const plain = withPageNavigation(hostNavigation(), (tab) =>
      plainSelected.push(tab),
    );
    expect(openDeskSurface(plain, "projects-dashboard")).toBe(true);
    expect(plainSelected).toEqual(["dashboard"]);
    expect(typeof useReportTaskRequest).toBe("function");
  });
});
