/**
 * @vitest-environment jsdom
 */
// CUSTOM(pm-sidebar)
import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/navigation/workspace-route-navigation", () => ({
  navigateToHostWorkspaceRoute: () => undefined,
}));
const focusChatComposer = vi.hoisted(() => vi.fn(() => true));
vi.mock("@/chat-esc-focus/registry", () => ({ focusChatComposer }));
vi.mock("@/stores/navigation-active-workspace-store", () => ({
  getLastWorkspaceSelection: () => null,
}));

import {
  selectExplorerSidebarPaneId,
  useWorkspaceLayoutStore,
} from "@/stores/workspace-layout-store";
import { explorerShowsAssistant, followAssistantTab } from "./open";
import { useAssistantTabFollow } from "./use-assistant-tab-follow";

const A = "s1:a";
const B = "s1:b";

function assistantTabCount(workspaceKey: string): number {
  return useWorkspaceLayoutStore
    .getState()
    .getWorkspaceTabs(workspaceKey)
    .filter((tab) => tab.target.kind === "projects_assistant").length;
}

beforeEach(() => {
  useWorkspaceLayoutStore.setState({ layoutByWorkspace: {}, explorerSidebarPaneIdByWorkspace: {} });
  // The Project Manager tab is in front in workspace A's Explorer.
  followAssistantTab(A);
});

afterEach(cleanup);

describe("useAssistantTabFollow", () => {
  it("moves the Project Manager tab with the locked, open sidebar to the next workspace", () => {
    const { rerender } = renderHook((props) => useAssistantTabFollow(props), {
      initialProps: { workspaceKey: A, lockedOpen: true },
    });

    rerender({ workspaceKey: B, lockedOpen: true });

    expect(explorerShowsAssistant(B)).toBe(true);
    expect(assistantTabCount(A)).toBe(0);
    expect(assistantTabCount(B)).toBe(1);
  });

  // CUSTOM(pm-focus): switching the project in the central composer moves the Desk to another
  // workspace; the tab follows, but the caret stays in the composer where the switch was made.
  it("follows a project switch without focusing the Project Manager composer", () => {
    vi.useFakeTimers();
    focusChatComposer.mockClear();
    try {
      const { rerender } = renderHook((props) => useAssistantTabFollow(props), {
        initialProps: { workspaceKey: A, lockedOpen: true },
      });
      rerender({ workspaceKey: B, lockedOpen: true });
      vi.advanceTimersByTime(5000);
    } finally {
      vi.useRealTimers();
    }

    expect(explorerShowsAssistant(B)).toBe(true);
    expect(focusChatComposer).not.toHaveBeenCalled();
  });

  it("leaves it behind when the sidebar is closed or unlocked", () => {
    const { rerender } = renderHook((props) => useAssistantTabFollow(props), {
      initialProps: { workspaceKey: A, lockedOpen: false },
    });

    rerender({ workspaceKey: B, lockedOpen: false });

    expect(assistantTabCount(A)).toBe(1);
    expect(assistantTabCount(B)).toBe(0);
  });

  it("leaves it behind when the Explorer showed another tab", () => {
    const store = useWorkspaceLayoutStore.getState();
    const paneId = selectExplorerSidebarPaneId(store, A)!;
    store.openTab({
      workspaceKey: A,
      target: { kind: "files" },
      intent: "reveal",
      placement: { mode: "pane", paneId },
    });
    expect(explorerShowsAssistant(A)).toBe(false);
    const { rerender } = renderHook((props) => useAssistantTabFollow(props), {
      initialProps: { workspaceKey: A, lockedOpen: true },
    });

    rerender({ workspaceKey: B, lockedOpen: true });

    expect(assistantTabCount(A)).toBe(1);
    expect(assistantTabCount(B)).toBe(0);
  });
});
