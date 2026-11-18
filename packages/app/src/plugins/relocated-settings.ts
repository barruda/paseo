// CUSTOM(appearance-plugin-tabs): some plugins (Backgrounds) register a settings screen and a
// sidebar footer link. We show that settings screen as a tab in Settings > Appearance and hide
// the link, so the appearance options live together. See custom/CHANGES.md.
import type { PluginSidebarGroup } from "./sidebar-groups";
import type { InstalledPlugin, PluginSidebarSection } from "./types";

export const APPEARANCE_PLUGIN_TABS: readonly {
  pluginId: string;
  screenId: string;
  sidebarFooterItemId: string;
}[] = [{ pluginId: "paseo-background", screenId: "background", sidebarFooterItemId: "background" }];

export interface AppearancePluginTab {
  key: string;
  serverId: string;
  pluginId: string;
  screenId: string;
  title: string;
}

export function resolveAppearancePluginTabs(plugins: InstalledPlugin[]): AppearancePluginTab[] {
  const tabs: AppearancePluginTab[] = [];
  for (const entry of APPEARANCE_PLUGIN_TABS) {
    for (const plugin of plugins) {
      if (plugin.id !== entry.pluginId) continue;
      const screen = plugin.settingsScreens.find((candidate) => candidate.id === entry.screenId);
      if (!screen) continue;
      tabs.push({
        key: `${entry.pluginId}/${entry.screenId}`,
        serverId: plugin.serverId,
        pluginId: entry.pluginId,
        screenId: entry.screenId,
        title: plugin.i18n.resolve(screen.title, plugin.locale),
      });
      break;
    }
  }
  return tabs;
}

export function withoutRelocatedSidebarGroups(
  groups: PluginSidebarGroup[],
  section: PluginSidebarSection,
): PluginSidebarGroup[] {
  if (section !== "footer") return groups;
  return groups.filter(
    (group) =>
      !APPEARANCE_PLUGIN_TABS.some(
        (entry) =>
          entry.pluginId === group.pluginId && entry.sidebarFooterItemId === group.contributionId,
      ),
  );
}
