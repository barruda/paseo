// CUSTOM(workboard-chip-only): every Power Workboard open in Tasks mode selects its Desk chip.
import { beforeEach, describe, expect, it, vi } from "vitest";

const routes = vi.hoisted(() => ({
  pushed: [] as string[],
  workspace: [] as string[],
  last: { serverId: "local", workspaceId: "ws-1" } as {
    serverId: string;
    workspaceId: string;
  } | null,
}));
vi.mock("expo-router", () => ({
  router: { push: (route: string) => routes.pushed.push(route) },
}));
vi.mock("@/navigation/workspace-route-navigation", () => ({
  navigateToHostWorkspaceRoute: (route: string) => routes.workspace.push(route),
}));
vi.mock("@/stores/navigation-active-workspace-store", () => ({
  getLastWorkspaceSelection: () => routes.last,
  navigateToWorkspace: () => {
    throw new Error("the board panel must not open as a workspace tab");
  },
}));

import { createPluginNavigation } from "@/plugins/navigation";
import { useDeskWorkboardStore } from "./desk-workboard-store";
import { activeDesk, activeDeskTab, deskTabs, useDesksStore } from "./desks-store";
import { launchDeskTarget } from "./new-tab-menu";
import { useTaskNavigationStore } from "./store";

describe("Power Workboard opens on its Desk chip", () => {
  beforeEach(() => {
    routes.pushed.length = 0;
    routes.workspace.length = 0;
    routes.last = { serverId: "local", workspaceId: "ws-1" };
    useTaskNavigationStore.setState({ enabled: true });
    useDeskWorkboardStore.setState({
      open: { "power-workboard": false },
      selected: null,
      tab: "dashboard",
    });
  });
  const navigation = () => createPluginNavigation({ serverId: "local", workspaceId: "ws-1" });

  it("from the Command Center: reopens and selects the chip and shows the Desk", () => {
    navigation().openSurface("power-workboard", "power-workboard");
    expect(useDeskWorkboardStore.getState()).toMatchObject({
      open: { "power-workboard": true },
      selected: "power-workboard",
      tab: "dashboard",
    });
    expect(routes.pushed).toEqual([]);
    expect(routes.workspace).toEqual(["/h/local/workspace/ws-1"]);
  });

  it("from a screen open with a tab: the chip on that tab, asked again each time", () => {
    navigation().openSurface("power-workboard", "power-workboard", { tab: "reports" });
    const first = useDeskWorkboardStore.getState();
    expect(first).toMatchObject({ selected: "power-workboard", tab: "reports" });
    navigation().openSurface("power-workboard", "power-workboard", { tab: "reports" });
    expect(useDeskWorkboardStore.getState().tabRequest).not.toBe(first.tabRequest);
    navigation().openSurface("power-workboard", "power-workboard", {
      tab: "reports",
      request: "r-1",
    });
    expect(useDeskWorkboardStore.getState().tabRequest).toBe("r-1");
  });

  it("from Open Power Workboard tab: the chip, no workspace tab", () => {
    navigation().openWorkspacePanel("power-workboard", "power-workboard", "workspace");
    expect(useDeskWorkboardStore.getState().selected).toBe("power-workboard");
  });

  it("with no workspace shown yet: the chip on the caller's own workspace, never a tab", () => {
    routes.last = null;
    createPluginNavigation({ serverId: "local", workspaceId: "ws-2" }).openWorkspacePanel(
      "power-workboard",
      "power-workboard",
      "workspace",
    );
    expect(useDeskWorkboardStore.getState().selected).toBe("power-workboard");
    expect(routes.workspace).toEqual(["/h/local/workspace/ws-2"]);
    createPluginNavigation({ serverId: "local", workspaceId: "ws-2" }).openSurface(
      "power-workboard",
      "power-workboard",
    );
    expect(routes.pushed).toEqual([]);
  });

  it("from the Desk's +: the chip, and the launching New tab goes away", () => {
    const owner = { serverId: "local", workspaceId: "ws-1" };
    useDesksStore.getState().createNewTab(owner);
    const launcher = activeDeskTab(useDesksStore.getState())!;
    launchDeskTarget(
      owner,
      {
        kind: "plugin",
        pluginId: "power-workboard",
        panelId: "power-workboard",
        context: "workspace",
      },
      { kind: "replace", tabId: launcher.id },
    );
    expect(useDeskWorkboardStore.getState().selected).toBe("power-workboard");
    const tabs = deskTabs(activeDesk(useDesksStore.getState()));
    expect(tabs.some((tab) => tab.id === launcher.id)).toBe(false);
    expect(tabs.some((tab) => tab.target.kind === "plugin")).toBe(false);
  });

  it("outside Tasks mode: the plugin page as before", () => {
    useTaskNavigationStore.setState({ enabled: false });
    navigation().openSurface("power-workboard", "power-workboard");
    expect(useDeskWorkboardStore.getState().selected).toBeNull();
    expect(routes.pushed).toHaveLength(1);
  });

  it("a select survives the Desk tab change of the same update", () => {
    const before = useDeskWorkboardStore.getState().revision;
    useDeskWorkboardStore.getState().openSurface("power-workboard");
    expect(useDeskWorkboardStore.getState().revision).toBe(before + 1);
  });
});
