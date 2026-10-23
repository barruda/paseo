// CUSTOM(bottom-panel-warp)
import { describe, expect, it } from "vitest";
import { resolveBottomPanelWarpTarget, resolveDeskBottomPanelShow } from "./bottom-panel-default";

const warp = {
  id: "warp",
  serverId: "host-a",
  workspacePanels: [{ id: "warp", context: "workspace" }],
};

describe("resolveBottomPanelWarpTarget", () => {
  it("opens the Warp panel in Electron when the host has the Warp plugin", () => {
    expect(
      resolveBottomPanelWarpTarget({ serverId: "host-a", plugins: [warp], isElectron: true }),
    ).toEqual({ kind: "plugin", pluginId: "warp", panelId: "warp", context: "workspace" });
  });

  it("falls back to a terminal outside Electron", () => {
    expect(
      resolveBottomPanelWarpTarget({ serverId: "host-a", plugins: [warp], isElectron: false }),
    ).toBeNull();
  });

  it("falls back to a terminal when the workspace's host lacks the Warp plugin", () => {
    expect(
      resolveBottomPanelWarpTarget({ serverId: "host-b", plugins: [warp], isElectron: true }),
    ).toBeNull();
    expect(
      resolveBottomPanelWarpTarget({
        serverId: "host-a",
        plugins: [{ ...warp, workspacePanels: [] }],
        isElectron: true,
      }),
    ).toBeNull();
  });
});

// CUSTOM(desk-bottom-panel-warp)
describe("resolveDeskBottomPanelShow", () => {
  const warpPanel = {
    kind: "plugin" as const,
    pluginId: "warp",
    panelId: "warp",
    context: "workspace" as const,
  };
  const warpBrowsers = new Set(["warp-browser"]);
  const isWarpBrowser = (id: string) => warpBrowsers.has(id);
  const tabs = [
    { id: "t1", workspaceId: "api", target: { kind: "terminal" as const, terminalId: "x" } },
    {
      id: "t2",
      workspaceId: "api",
      target: { kind: "browser" as const, browserId: "warp-browser" },
    },
    { id: "t3", workspaceId: "web", target: { kind: "browser" as const, browserId: "docs" } },
    { id: "t4", workspaceId: "app", target: warpPanel },
  ];

  it("opens a Warp tab when the workspace has none in the panel", () => {
    expect(
      resolveDeskBottomPanelShow({ tabs, focusedTabId: "t2", workspaceId: "web", isWarpBrowser }),
    ).toEqual({ kind: "open" });
  });

  it("selects the workspace's Warp tab instead of opening another", () => {
    expect(
      resolveDeskBottomPanelShow({ tabs, focusedTabId: "t3", workspaceId: "api", isWarpBrowser }),
    ).toEqual({ kind: "select", tabId: "t2" });
    expect(
      resolveDeskBottomPanelShow({ tabs, focusedTabId: "t1", workspaceId: "app", isWarpBrowser }),
    ).toEqual({ kind: "select", tabId: "t4" });
  });

  it("keeps the panel as it is when its Warp tab is already selected", () => {
    expect(
      resolveDeskBottomPanelShow({ tabs, focusedTabId: "t2", workspaceId: "api", isWarpBrowser }),
    ).toEqual({ kind: "keep" });
  });
});
