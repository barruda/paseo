/**
 * @vitest-environment jsdom
 */
// CUSTOM(assistant-sidebar)
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/stores/workspace-layout-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/stores/workspace-layout-store")>();
  return { ...actual, useWorkspaceLayoutStoreHydrated: () => true };
});

import {
  collectAllTabs,
  findPaneById,
  selectExplorerSidebarPaneId,
  selectIsExplorerSidebarVisible,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { revealAssistantTab, useAssistantSidebarReveal } from "./reveal";
import { useAssistantSidebarStore } from "./store";

const WORKSPACE_KEY = "srv:ws";

const explorerKinds = (workspaceKey: string) => {
  const state = useWorkspaceLayoutStore.getState();
  const layout = state.layoutByWorkspace[workspaceKey];
  if (!layout) return [];
  const pane = findPaneById(layout.root, selectExplorerSidebarPaneId(state, workspaceKey));
  if (!pane) return [];
  return collectAllTabs(layout.root)
    .filter((tab) => pane.tabIds.includes(tab.tabId))
    .map((tab) => tab.target.kind);
};

afterEach(cleanup);

beforeEach(() => {
  useWorkspaceLayoutStore.setState({
    layoutByWorkspace: {},
    explorerSidebarPaneIdByWorkspace: {},
    sidePaneIdByWorkspace: {},
    splitSizesByWorkspace: {},
  });
  useAssistantSidebarStore.setState({
    chat: null,
    requestSeq: 0,
    handledSeq: 0,
    focusComposer: false,
  });
});

describe("revealAssistantTab", () => {
  it("opens the Explorer and adds the single Projects Assistant tab inside it", () => {
    revealAssistantTab({ workspaceKey: WORKSPACE_KEY, isCompact: false });
    expect(selectIsExplorerSidebarVisible(useWorkspaceLayoutStore.getState(), WORKSPACE_KEY)).toBe(
      true,
    );
    expect(explorerKinds(WORKSPACE_KEY)).toContain("projects_assistant");
    expect(
      explorerKinds(WORKSPACE_KEY).filter((kind) => kind === "projects_assistant"),
    ).toHaveLength(1);
  });
});

describe("useAssistantSidebarReveal", () => {
  it("handles a pending request once and calls onRevealed", () => {
    const onRevealed = vi.fn();
    useAssistantSidebarStore.getState().request({ serverId: "srv", agentId: "chat" }, false);
    const requestSeq = useAssistantSidebarStore.getState().requestSeq;

    renderHook(() =>
      useAssistantSidebarReveal({ workspaceKey: WORKSPACE_KEY, enabled: true, onRevealed }),
    );

    expect(useAssistantSidebarStore.getState().handledSeq).toBe(requestSeq);
    expect(onRevealed).toHaveBeenCalledTimes(1);
    expect(explorerKinds(WORKSPACE_KEY)).toContain("projects_assistant");
  });

  it("waits for an enabled screen with a workspace", () => {
    useAssistantSidebarStore.getState().request({ serverId: "srv", agentId: "chat" }, false);

    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useAssistantSidebarReveal({ workspaceKey: WORKSPACE_KEY, enabled }),
      { initialProps: { enabled: false } },
    );
    expect(useAssistantSidebarStore.getState().handledSeq).toBe(0);
    expect(explorerKinds(WORKSPACE_KEY)).toEqual([]);

    rerender({ enabled: true });
    expect(useAssistantSidebarStore.getState().handledSeq).toBe(1);
    expect(explorerKinds(WORKSPACE_KEY)).toContain("projects_assistant");
  });

  it("ignores a request with no workspace to show it in", () => {
    useAssistantSidebarStore.getState().request({ serverId: "srv", agentId: "chat" }, false);
    renderHook(() =>
      useAssistantSidebarReveal({ workspaceKey: null, enabled: true, onRevealed: vi.fn() }),
    );
    expect(useAssistantSidebarStore.getState().handledSeq).toBe(0);
  });
});
