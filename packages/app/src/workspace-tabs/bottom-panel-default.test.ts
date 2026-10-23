// CUSTOM(bottom-panel-warp)
import { describe, expect, it } from "vitest";
import { pickBottomPanelWarpTab, resolveBottomPanelWarpTarget } from "./bottom-panel-default";
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

// CUSTOM(bottom-panel-warp-tab-button)
describe("pickBottomPanelWarpTab", () => {
  const isWarpBrowser = (id: string) => id.startsWith("warp");
  const tab = (tabId: string, target: WorkspaceTabTarget, isActive = false) => ({
    tabId,
    target,
    isActive,
  });
  const terminal = tab("t1", { kind: "terminal", terminalId: "x" }, true);
  const docs = tab("t2", { kind: "browser", browserId: "docs" });
  const warp1 = tab("t3", { kind: "browser", browserId: "warp-1" });
  const warp2 = tab("t4", { kind: "browser", browserId: "warp-2" }, true);

  it("prefers the selected Warp tab", () => {
    expect(pickBottomPanelWarpTab([warp1, warp2], isWarpBrowser)).toEqual({
      tabId: "t4",
      browserId: "warp-2",
    });
  });

  it("falls back to the first Warp tab when the selected tab isn't Warp", () => {
    expect(pickBottomPanelWarpTab([terminal, docs, warp1], isWarpBrowser)).toEqual({
      tabId: "t3",
      browserId: "warp-1",
    });
  });

  it("finds nothing when the panel has no Warp browser tab", () => {
    const starting = tab("t5", {
      kind: "plugin",
      pluginId: "warp",
      panelId: "warp",
      context: "workspace",
    });
    expect(pickBottomPanelWarpTab([terminal, docs, starting], isWarpBrowser)).toBeNull();
  });
});
