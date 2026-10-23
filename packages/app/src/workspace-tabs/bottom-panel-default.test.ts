// CUSTOM(bottom-panel-warp)
import { describe, expect, it } from "vitest";
import { resolveBottomPanelWarpTarget, resolveDeskBottomPanelShow } from "./bottom-panel-default";
import type { WorkspaceTabTarget } from "./model";

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
  const isWarpBrowser = (id: string) => id.startsWith("warp");
  const sessions: Record<string, string> = { "warp-1": "/src/api", "warp-2": "/src/web" };
  const sessionDirectory = (id: string) => sessions[id] ?? null;
  const tabs: { id: string; target: WorkspaceTabTarget }[] = [
    { id: "t1", target: { kind: "terminal", terminalId: "x" } },
    { id: "t2", target: { kind: "browser", browserId: "warp-1" } },
    { id: "t3", target: { kind: "browser", browserId: "docs" } },
    { id: "t4", target: { kind: "browser", browserId: "warp-2" } },
  ];
  const show = (focusedTabId: string, directory: string, panelTabs = tabs) =>
    resolveDeskBottomPanelShow({
      tabs: panelTabs,
      focusedTabId,
      directory,
      isWarpBrowser,
      sessionDirectory,
    });

  it("opens a Warp session in the selected Warp tab when it's in another folder", () => {
    expect(show("t2", "/src/app")).toEqual({
      kind: "new-session",
      tabId: "t2",
      browserId: "warp-1",
    });
    expect(show("t4", "/src/api")).toEqual({
      kind: "new-session",
      tabId: "t4",
      browserId: "warp-2",
    });
  });

  it("leaves the panel alone when its Warp tab is already in the folder", () => {
    expect(show("t2", "/src/api")).toEqual({ kind: "keep" });
  });

  it("uses the first Warp tab when the selected tab isn't Warp", () => {
    expect(show("t3", "/src/api")).toEqual({ kind: "select", tabId: "t2" });
    expect(show("t1", "/src/app")).toEqual({
      kind: "new-session",
      tabId: "t2",
      browserId: "warp-1",
    });
  });

  it("opens a Warp tab when the panel has none", () => {
    expect(show("t1", "/src/api", [tabs[0]!, tabs[2]!])).toEqual({ kind: "open" });
  });

  it("only selects a Warp panel that hasn't become its browser tab yet", () => {
    const starting = [tabs[0]!, { id: "t5", target: warpPanel }];
    expect(show("t1", "/src/api", starting)).toEqual({ kind: "select", tabId: "t5" });
    expect(show("t5", "/src/api", starting)).toEqual({ kind: "keep" });
  });
});
