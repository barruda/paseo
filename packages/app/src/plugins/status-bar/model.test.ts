// CUSTOM(status-bar)
import { PluginTranslationRuntime } from "@getpaseo/plugin/client/host";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { rememberPluginContributionHost, pluginScreensHostKey } from "../contribution-host";
import type { InstalledPlugin, PluginStatusBarItemContribution } from "../types";
import {
  groupPluginStatusBarItems,
  layoutPluginStatusBar,
  selectPluginStatusBarTarget,
  statusBarOwnsAgentStatusLine,
} from "./model";

function item(
  id: string,
  extra: Partial<PluginStatusBarItemContribution> = {},
): PluginStatusBarItemContribution {
  return { id, title: id, Component: () => null, ...extra };
}

function installed(
  serverId: string,
  statusBarItems: PluginStatusBarItemContribution[],
  pluginId = "example",
): InstalledPlugin {
  return {
    id: pluginId,
    cleanup: () => undefined,
    serverId,
    clientBundle: serverId,
    lifetime: new AbortController(),
    locale: "en",
    i18n: new PluginTranslationRuntime({ getLocale: () => "en", subscribe: () => () => {} }),
    queryClient: new QueryClient(),
    paseo: {} as InstalledPlugin["paseo"],
    invoke: async () => undefined,
    subscribe: () => {
      throw new Error("Subscriptions are not used here");
    },
    settingsScreens: [],
    surfaces: [],
    sidebarItems: { header: [], footer: [] },
    legacySidebarItems: [],
    sidebarViews: [],
    workspaceRowBadgeItems: [],
    composerItems: [],
    newWorkspaceItems: [],
    statusBarItems,
    filePanels: [],
    workspacePanels: [],
    commandCenterItems: [],
    clientSlashCommands: [],
    attachmentSources: [],
    themes: [],
    timelineTransformers: [],
    timelineRenderers: [],
  };
}

describe("groupPluginStatusBarItems", () => {
  it("coalesces one contribution across hosts", () => {
    const groups = groupPluginStatusBarItems([
      installed("host-a", [item("work")]),
      installed("host-b", [item("work")]),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe("example/status-bar/work");
    expect(groups[0]?.targets.map((target) => target.plugin.serverId)).toEqual([
      "host-a",
      "host-b",
    ]);
  });

  it("keeps different plugins' items with the same id apart", () => {
    const groups = groupPluginStatusBarItems([
      installed("host-a", [item("work")], "one"),
      installed("host-a", [item("work")], "two"),
    ]);
    expect(groups.map((group) => group.key)).toEqual([
      "one/status-bar/work",
      "two/status-bar/work",
    ]);
  });
});

describe("layoutPluginStatusBar", () => {
  it("splits by side and orders by priority, ties in registration order", () => {
    const { left, right } = layoutPluginStatusBar([
      installed("host-a", [
        item("l-low", { priority: -1 }),
        item("l-tie-1"),
        item("l-high", { priority: 5, side: "left" }),
        item("l-tie-2"),
        item("r-outer", { side: "right", priority: 9 }),
        item("r-tie-1", { side: "right" }),
        item("r-tie-2", { side: "right" }),
        item("r-inner", { side: "right", priority: -3 }),
      ]),
    ]);
    expect(left.map((group) => group.contributionId)).toEqual([
      "l-high",
      "l-tie-1",
      "l-tie-2",
      "l-low",
    ]);
    // Left to right: the highest priority sits at the right edge.
    expect(right.map((group) => group.contributionId)).toEqual([
      "r-inner",
      "r-tie-1",
      "r-tie-2",
      "r-outer",
    ]);
  });

  it("returns empty sides when nothing is contributed", () => {
    expect(layoutPluginStatusBar([installed("host-a", [])])).toEqual({ left: [], right: [] });
  });
});

describe("selectPluginStatusBarTarget", () => {
  it("prefers the route host, then the remembered host, then the first", () => {
    const [group] = groupPluginStatusBarItems([
      installed("host-a", [item("work")], "picker"),
      installed("host-b", [item("work")], "picker"),
      installed("host-c", [item("work")], "picker"),
    ]);
    if (!group) throw new Error("expected a group");
    expect(selectPluginStatusBarTarget(group, "host-b").plugin.serverId).toBe("host-b");
    expect(selectPluginStatusBarTarget(group, null).plugin.serverId).toBe("host-a");
    rememberPluginContributionHost(pluginScreensHostKey("picker"), "host-c");
    expect(selectPluginStatusBarTarget(group, null).plugin.serverId).toBe("host-c");
    expect(selectPluginStatusBarTarget(group, "host-b").plugin.serverId).toBe("host-b");
  });
});

describe("statusBarOwnsAgentStatusLine", () => {
  const plugins = [installed("host-a", [item("work", { agentLabel: "workboard" }), item("x")])];

  it("is true when the agent carries a label some item owns, whatever its value", () => {
    expect(statusBarOwnsAgentStatusLine(plugins, { workboard: "" })).toBe(true);
    expect(statusBarOwnsAgentStatusLine(plugins, { workboard: "a", other: "b" })).toBe(true);
  });

  it("is false without a matching label, without labels, or without items", () => {
    expect(statusBarOwnsAgentStatusLine(plugins, { other: "b" })).toBe(false);
    expect(statusBarOwnsAgentStatusLine(plugins, {})).toBe(false);
    expect(statusBarOwnsAgentStatusLine(plugins, undefined)).toBe(false);
    expect(statusBarOwnsAgentStatusLine([installed("host-a", [])], { workboard: "a" })).toBe(false);
  });
});
