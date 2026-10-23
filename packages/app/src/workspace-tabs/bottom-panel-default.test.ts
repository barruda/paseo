// CUSTOM(bottom-panel-warp)
import { describe, expect, it } from "vitest";
import { resolveBottomPanelWarpTarget } from "./bottom-panel-default";

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
