import { describe, expect, it } from "vitest";
import { buildHostAgentDetailRoute, buildHostWorkspaceRoute } from "@/utils/host-routes";
import { createPluginHostNavigation, withBeforeNavigate } from "./host-navigation-model";
import { useSidebarViewStore } from "../stores/sidebar-view-store";

describe("plugin host navigation", () => {
  function setup(electron = true) {
    const destinations: unknown[] = [];
    const browsers: string[] = [];
    const focusedHosts: string[] = [];
    const workspaces = new Set(["selected:one", "remote:two"]);
    const navigation = createPluginHostNavigation("selected", {
      browserAvailable: electron,
      isHostRegistered: (serverId: string) => serverId === "selected" || serverId === "remote",
      resolveWorkspace: ({ serverId, workspaceId }) =>
        workspaces.has(`${serverId}:${workspaceId}`) ? workspaceId : null,
      openAgent: (input) => {
        destinations.push(input);
        return buildHostAgentDetailRoute(input.serverId, input.agentId);
      },
      openWorkspace: (input) => {
        destinations.push(input);
        return buildHostWorkspaceRoute(input.serverId, input.workspaceId);
      },
      focusHost: (serverId) => {
        focusedHosts.push(serverId);
        useSidebarViewStore.getState().focusHost(serverId);
      },
      createBrowser: ({ initialUrl }) => {
        browsers.push(initialUrl);
        return { browserId: `browser-${browsers.length}` };
      },
    });
    return { navigation, destinations, browsers, workspaces, focusedHosts };
  }

  // CUSTOM(assistant-desk)
  it("passes the Projects Assistant flag through to the agent open", () => {
    const { navigation, destinations } = setup();
    (navigation.openAgent as (input: { agentId: string; assistantSidebar?: boolean }) => void)({
      agentId: "chat",
      assistantSidebar: true,
    });
    navigation.openAgent({ agentId: "plain" });
    expect(destinations).toEqual([
      { serverId: "selected", agentId: "chat", assistantSidebar: true },
      { serverId: "selected", agentId: "plain" },
    ]);
  });

  it("focuses the destination host and clears filters that could hide its workspace", () => {
    useSidebarViewStore.setState({
      groupMode: "status",
      hostFilters: ["selected", "other"],
      projectFilters: ["old-project"],
      labelFilter: { labels: ["urgent"] },
    });
    const { navigation, destinations, focusedHosts } = setup(false);
    navigation.openAgent({ serverId: "remote", agentId: "agent-2", focusHost: true });
    expect(focusedHosts).toEqual(["remote"]);
    expect(destinations).toEqual([{ serverId: "remote", agentId: "agent-2" }]);
    expect(useSidebarViewStore.getState()).toMatchObject({
      groupMode: "status",
      hostFilters: ["remote"],
      projectFilters: [],
      labelFilter: { labels: [] },
    });
  });

  it("creates and focuses a local browser in the selected or explicit host workspace", () => {
    const { navigation, destinations, browsers } = setup();
    navigation.openBrowser!({ url: "https://example.com/one", workspaceId: "one" });
    navigation.openBrowser!({
      url: "https://example.com/two",
      workspaceId: "two",
      serverId: "remote",
    });
    expect(browsers).toEqual(["https://example.com/one", "https://example.com/two"]);
    expect(destinations).toEqual([
      {
        serverId: "selected",
        workspaceId: "one",
        target: { kind: "browser", browserId: "browser-1" },
      },
      {
        serverId: "remote",
        workspaceId: "two",
        target: { kind: "browser", browserId: "browser-2" },
      },
    ]);
  });

  // CUSTOM(turn-jump)
  it("asks for a turn jump on the destination host before opening the agent", () => {
    const events: unknown[] = [];
    const navigation = createPluginHostNavigation("selected", {
      browserAvailable: false,
      isHostRegistered: () => true,
      resolveWorkspace: () => null,
      openAgent: (input) => {
        events.push({ open: input });
        return "/h/route";
      },
      openWorkspace: () => "/h/route",
      createBrowser: () => ({ browserId: "unused" }),
      focusHost: () => undefined,
      requestTurnJump: (input) => events.push({ jump: input }),
    });
    navigation.openAgent({ agentId: "a1", turnStartedAt: "2026-11-03T18:11:53.297Z" });
    navigation.openAgent({ agentId: "a2", serverId: "remote" });
    expect(events).toEqual([
      {
        jump: { serverId: "selected", agentId: "a1", turnStartedAt: "2026-11-03T18:11:53.297Z" },
      },
      { open: { serverId: "selected", agentId: "a1" } },
      { open: { serverId: "remote", agentId: "a2" } },
    ]);
  });

  it("can return from a remote workspace to the installation host without toggling it off", () => {
    const { navigation, destinations, focusedHosts } = setup();
    navigation.openWorkspace({ serverId: "remote", workspaceId: "two", focusHost: true });
    navigation.openWorkspace({ workspaceId: "one", focusHost: true });
    navigation.openWorkspace({ workspaceId: "one", focusHost: true });
    expect(focusedHosts).toEqual(["remote", "selected", "selected"]);
    expect(destinations).toEqual([
      { serverId: "remote", workspaceId: "two" },
      { serverId: "selected", workspaceId: "one" },
      { serverId: "selected", workspaceId: "one" },
    ]);
    expect(useSidebarViewStore.getState().hostFilters).toEqual(["selected"]);
  });

  it("focuses the host in the returned route for padded host IDs", () => {
    const { navigation, destinations, focusedHosts } = setup();
    navigation.openAgent({ serverId: " remote ", agentId: "agent-2", focusHost: true });
    navigation.openWorkspace({ serverId: " selected ", workspaceId: "one", focusHost: true });

    expect(destinations).toEqual([
      { serverId: " remote ", agentId: "agent-2" },
      { serverId: " selected ", workspaceId: "one" },
    ]);
    expect(focusedHosts).toEqual(["remote", "selected"]);
    expect(useSidebarViewStore.getState().hostFilters).toEqual(["selected"]);
  });

  it("leaves existing sidebar filters alone unless explicitly requested", () => {
    useSidebarViewStore.setState({
      hostFilters: ["remote"],
      projectFilters: ["pinned-project"],
      labelFilter: { labels: ["urgent"] },
    });
    const { navigation, destinations, focusedHosts } = setup();
    navigation.openAgent({ agentId: "agent-1", serverId: " remote " });
    navigation.openWorkspace({ workspaceId: "one", serverId: " selected ", focusHost: false });
    expect(destinations).toEqual([
      { serverId: " remote ", agentId: "agent-1" },
      { serverId: " selected ", workspaceId: "one" },
    ]);
    expect(focusedHosts).toEqual([]);
    expect(useSidebarViewStore.getState()).toMatchObject({
      hostFilters: ["remote"],
      projectFilters: ["pinned-project"],
      labelFilter: { labels: ["urgent"] },
    });
    expect(navigation.supportsFocusHost).toBe(true);
  });

  it("preserves sidebar filters when the navigation route has no destination", () => {
    const filters = {
      hostFilters: ["selected"],
      projectFilters: ["pinned-project"],
      labelFilter: { labels: ["urgent"] },
    };
    useSidebarViewStore.setState(filters);
    const { navigation } = setup();
    navigation.openAgent({ serverId: "remote", agentId: " ", focusHost: true });
    navigation.openWorkspace({ serverId: "remote", workspaceId: "", focusHost: true });

    expect(useSidebarViewStore.getState()).toMatchObject(filters);
  });

  it("preserves sidebar filters when the destination host has been removed", () => {
    const filters = {
      hostFilters: ["selected"],
      projectFilters: ["pinned-project"],
      labelFilter: { labels: ["urgent"] },
    };
    useSidebarViewStore.setState(filters);
    const { navigation, destinations } = setup();
    navigation.openAgent({ serverId: "removed", agentId: "agent-2", focusHost: true });
    navigation.openWorkspace({ serverId: "removed", workspaceId: "two", focusHost: true });

    expect(useSidebarViewStore.getState()).toMatchObject(filters);
    expect(destinations).toEqual([
      { serverId: "removed", agentId: "agent-2" },
      { serverId: "removed", workspaceId: "two" },
    ]);
  });

  it("does not change the filter when navigation rejects the target", () => {
    const focusedHosts: string[] = [];
    const unavailable = () => {
      throw new Error("Target unavailable");
    };
    const navigation = createPluginHostNavigation("selected", {
      browserAvailable: false,
      isHostRegistered: () => true,
      resolveWorkspace: () => null,
      openAgent: unavailable,
      openWorkspace: unavailable,
      createBrowser: unavailable,
      focusHost: (serverId) => focusedHosts.push(serverId),
    });
    expect(() => navigation.openAgent({ agentId: "missing", focusHost: true })).toThrow(
      "Target unavailable",
    );
    expect(() => navigation.openWorkspace({ workspaceId: "missing", focusHost: true })).toThrow(
      "Target unavailable",
    );
    expect(focusedHosts).toEqual([]);
  });

  it("refuses unknown or removed workspaces before creating browser records", () => {
    const { navigation, destinations, browsers, workspaces } = setup();
    expect(() =>
      navigation.openBrowser!({ url: "https://example.com", workspaceId: "missing" }),
    ).toThrow("Workspace is unavailable");
    expect(() =>
      navigation.openBrowser!({
        url: "https://example.com",
        workspaceId: "one",
        serverId: "unknown",
      }),
    ).toThrow("Workspace is unavailable");
    workspaces.delete("selected:one");
    expect(() =>
      navigation.openBrowser!({ url: "https://example.com", workspaceId: "one" }),
    ).toThrow("Workspace is unavailable");
    expect(destinations).toEqual([]);
    expect(browsers).toEqual([]);
  });

  // CUSTOM(browser-no-toolbar)
  it("opens a browser without its toolbar when the plugin asks", () => {
    const created: unknown[] = [];
    const navigation = createPluginHostNavigation("selected", {
      browserAvailable: true,
      isHostRegistered: () => true,
      focusHost: () => undefined,
      resolveWorkspace: ({ workspaceId }) => workspaceId,
      openAgent: () => "/h/route",
      openWorkspace: () => "/h/route",
      createBrowser: (input) => {
        created.push(input);
        return { browserId: `browser-${created.length}` };
      },
    });
    navigation.openBrowser!({ url: "http://127.0.0.1:3030/", workspaceId: "one", toolbar: false });
    navigation.openBrowser!({ url: "https://example.com", workspaceId: "one" });
    expect(created).toEqual([
      { initialUrl: "http://127.0.0.1:3030/", hideToolbar: true },
      { initialUrl: "https://example.com" },
    ]);
  });

  // CUSTOM(browser-no-toolbar)
  it("turns a panel's tab into the browser, with the plugin's icon, when asked", () => {
    const created: unknown[] = [];
    const replaced: unknown[] = [];
    const opened: unknown[] = [];
    const navigation = createPluginHostNavigation("selected", {
      browserAvailable: true,
      isHostRegistered: () => true,
      focusHost: () => undefined,
      resolveWorkspace: ({ workspaceId }) => workspaceId,
      openAgent: () => "/h/route",
      openWorkspace: (input) => {
        opened.push(input);
        return "/h/route";
      },
      createBrowser: (input) => {
        created.push(input);
        return { browserId: "browser-1" };
      },
      replaceCurrentTab: (target) => replaced.push(target),
    });
    navigation.openBrowser!({
      url: "http://127.0.0.1:3030/",
      workspaceId: "one",
      icon: "SquareTerminal",
      replacePanel: true,
    });
    expect(created).toEqual([{ initialUrl: "http://127.0.0.1:3030/", tabIcon: "SquareTerminal" }]);
    expect(replaced).toEqual([{ kind: "browser", browserId: "browser-1" }]);
    expect(opened).toEqual([]);
  });

  it("exposes no browser capability outside Electron and creates no tabs", () => {
    const { navigation, destinations, browsers } = setup(false);
    expect(navigation.openBrowser).toBeUndefined();
    expect(destinations).toEqual([]);
    expect(browsers).toEqual([]);
  });

  it.each(["javascript:alert(1)", "file:///tmp/file", "/relative", "invalid"])(
    "rejects %s before creating a browser",
    (url) => {
      const { navigation, browsers, destinations } = setup();
      expect(() => navigation.openBrowser!({ url, workspaceId: "one" })).toThrow("HTTP(S)");
      expect(browsers).toEqual([]);
      expect(destinations).toEqual([]);
    },
  );

  it("rejects an empty workspace before creating a browser", () => {
    const { navigation, browsers } = setup();
    expect(() => navigation.openBrowser!({ url: "https://example.com", workspaceId: "" })).toThrow(
      "workspaceId",
    );
    expect(browsers).toEqual([]);
  });

  it("runs the before hook ahead of openAgent and openWorkspace, and passes openBrowser through", () => {
    const { navigation, destinations } = setup();
    const order: string[] = [];
    const wrapped = withBeforeNavigate(navigation, () =>
      order.push(`before:${destinations.length}`),
    );
    wrapped.openAgent({ agentId: "a1" });
    wrapped.openWorkspace({ workspaceId: "one" });
    expect(order).toEqual(["before:0", "before:1"]);
    expect(destinations).toHaveLength(2);
    expect(wrapped.openBrowser).toBe(navigation.openBrowser);
  });

  it("omits openBrowser when the host has none", () => {
    const { navigation } = setup(false);
    expect(withBeforeNavigate(navigation, () => {}).openBrowser).toBeUndefined();
  });
});
