// CUSTOM(bottom-panel-tab-keys)
import { describe, expect, it } from "vitest";
import {
  createDefaultLayout,
  createTabInLayout,
  FOCUSED_PANE_PLACEMENT,
  replaceTabTargetInLayout,
  type WorkspaceLayout,
} from "@/stores/workspace-layout-actions";
import { toggleBottomPanelInLayout } from "./bottom-panel";
import {
  isCloseSessionKey,
  isNewSessionKey,
  isTabCycleKey,
  layoutHasBrowserInBottomPanel,
} from "./bottom-panel-browser";

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}`;

function layoutWithBrowsers(): WorkspaceLayout {
  const main = createTabInLayout({
    layout: createDefaultLayout(),
    target: { kind: "browser", browserId: "main-browser" },
    now: 0,
    placement: FOCUSED_PANE_PLACEMENT,
    explorerSidebarPaneId: null,
    createTabId: () => nextId("tab"),
  })!.layout;
  const created = toggleBottomPanelInLayout({
    layout: main,
    explorerSidebarPaneId: null,
    createNodeId: nextId,
  });
  if (created?.kind !== "created") throw new Error("bottom panel not created");
  return replaceTabTargetInLayout({
    layout: created.layout,
    tabId: created.launcherTabId,
    target: { kind: "browser", browserId: "warp" },
    createTabId: () => nextId("tab"),
  })!.layout;
}

describe("bottom panel browser keys", () => {
  it("finds a browser in the bottom panel and not one in the main pane", () => {
    const layout = layoutWithBrowsers();
    expect(layoutHasBrowserInBottomPanel(layout, "warp")).toBe(true);
    expect(layoutHasBrowserInBottomPanel(layout, "main-browser")).toBe(false);
    expect(layoutHasBrowserInBottomPanel(layout, "missing")).toBe(false);
  });

  it("matches only Ctrl+Tab and Ctrl+Shift+Tab", () => {
    expect(isTabCycleKey({ key: "Tab", ctrlKey: true })).toBe(true);
    expect(isTabCycleKey({ key: "Tab", ctrlKey: true, shiftKey: true })).toBe(true);
    expect(isTabCycleKey({ key: "Tab" })).toBe(false);
    expect(isTabCycleKey({ key: "Tab", ctrlKey: true, altKey: true })).toBe(false);
    expect(isTabCycleKey({ key: "Tab", ctrlKey: true, metaKey: true })).toBe(false);
    expect(isTabCycleKey({ key: "t", ctrlKey: true })).toBe(false);
  });

  it("matches only Ctrl+W for closing a session", () => {
    expect(isCloseSessionKey({ key: "w", ctrlKey: true })).toBe(true);
    expect(isCloseSessionKey({ key: "W", ctrlKey: true })).toBe(true);
    expect(isCloseSessionKey({ key: "w" })).toBe(false);
    expect(isCloseSessionKey({ key: "w", ctrlKey: true, shiftKey: true })).toBe(false);
    expect(isCloseSessionKey({ key: "w", ctrlKey: true, altKey: true })).toBe(false);
    expect(isCloseSessionKey({ key: "w", ctrlKey: true, metaKey: true })).toBe(false);
    expect(isCloseSessionKey({ key: "t", ctrlKey: true })).toBe(false);
  });

  it("matches only Ctrl+T and Ctrl+Shift+T for opening a session", () => {
    expect(isNewSessionKey({ key: "t", ctrlKey: true })).toBe(true);
    expect(isNewSessionKey({ key: "T", ctrlKey: true, shiftKey: true })).toBe(true);
    expect(isNewSessionKey({ key: "t" })).toBe(false);
    expect(isNewSessionKey({ key: "t", ctrlKey: true, altKey: true })).toBe(false);
    expect(isNewSessionKey({ key: "t", ctrlKey: true, metaKey: true })).toBe(false);
    expect(isNewSessionKey({ key: "w", ctrlKey: true })).toBe(false);
  });
});
