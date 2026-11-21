import { PluginTranslationRuntime } from "@getpaseo/plugin/client/host";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { resolveAppearancePluginTabs, withoutRelocatedSidebarGroups } from "./relocated-settings";
import { groupPluginSidebarItems } from "./sidebar-groups";
import type { InstalledPlugin } from "./types";

function installed(
  serverId: string,
  pluginId: string,
  settingsScreenIds: string[] = [],
  footerIds: string[] = [],
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
    settingsScreens: settingsScreenIds.map((id) => ({
      id,
      title: `Title ${id}`,
      icon: "Image",
      Component: () => null,
    })),
    surfaces: [],
    sidebarItems: {
      header: [],
      footer: footerIds.map((id) => ({ id, title: `Item ${id}`, Component: () => null })),
    },
    legacySidebarItems: [],
    sidebarViews: [],
    workspaceRowBadgeItems: [],
    composerItems: [],
    newWorkspaceItems: [],
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

describe("resolveAppearancePluginTabs", () => {
  it("is empty when the plugin is not installed", () => {
    expect(resolveAppearancePluginTabs([installed("a", "other", ["background"])])).toEqual([]);
  });

  it("is empty when the plugin lacks the settings screen", () => {
    expect(resolveAppearancePluginTabs([installed("a", "paseo-background", ["x"])])).toEqual([]);
  });

  it("makes one tab when the plugin is on two hosts", () => {
    const tabs = resolveAppearancePluginTabs([
      installed("a", "paseo-background", ["background"]),
      installed("b", "paseo-background", ["background"]),
    ]);
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({
      serverId: "a",
      pluginId: "paseo-background",
      screenId: "background",
    });
  });

  it("resolves the title", () => {
    const [tab] = resolveAppearancePluginTabs([installed("a", "paseo-background", ["background"])]);
    expect(tab?.title).toBe("Title background");
  });
});

describe("withoutRelocatedSidebarGroups", () => {
  const plugins = [
    installed("a", "paseo-background", [], ["background", "other"]),
    installed("a", "example", [], ["background"]),
  ];

  it("drops the relocated footer group and keeps the others", () => {
    const groups = withoutRelocatedSidebarGroups(
      groupPluginSidebarItems(plugins, "footer"),
      "footer",
    );
    expect(groups.map((group) => `${group.pluginId}/${group.contributionId}`)).toEqual([
      "paseo-background/other",
      "example/background",
    ]);
  });

  it("leaves the header untouched", () => {
    const groups = groupPluginSidebarItems(
      [{ ...plugins[0]!, sidebarItems: { header: plugins[0]!.sidebarItems.footer, footer: [] } }],
      "header",
    );
    expect(withoutRelocatedSidebarGroups(groups, "header")).toBe(groups);
  });
});
