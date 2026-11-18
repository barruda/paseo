// CUSTOM(status-bar): pure model of the window's status bar. No React.
import { getPreferredPluginContributionHost, pluginScreensHostKey } from "../contribution-host";
import type { InstalledPlugin, PluginStatusBarItemContribution } from "../types";

export interface PluginStatusBarTarget {
  plugin: InstalledPlugin;
  item: PluginStatusBarItemContribution;
}

/** One status bar item, coalesced across every host (one InstalledPlugin each) that contributes it. */
export interface PluginStatusBarGroup {
  key: string;
  pluginId: string;
  contributionId: string;
  side: "left" | "right";
  priority: number;
  agentLabel: string | undefined;
  targets: PluginStatusBarTarget[];
}

export function statusBarGroupKey(pluginId: string, itemId: string): string {
  return `${pluginId}/status-bar/${itemId}`;
}

export function groupPluginStatusBarItems(plugins: InstalledPlugin[]): PluginStatusBarGroup[] {
  const groups = new Map<string, PluginStatusBarGroup>();
  for (const plugin of plugins) {
    for (const item of plugin.statusBarItems ?? []) {
      const key = statusBarGroupKey(plugin.id, item.id);
      const existing = groups.get(key);
      if (existing) {
        existing.targets.push({ plugin, item });
        continue;
      }
      groups.set(key, {
        key,
        pluginId: plugin.id,
        contributionId: item.id,
        side: item.side ?? "left",
        priority: item.priority ?? 0,
        agentLabel: item.agentLabel,
        targets: [{ plugin, item }],
      });
    }
  }
  return [...groups.values()];
}

/**
 * The groups of each side in display order, left to right. Priority puts an item nearer the bar's
 * outer edge on its side: left items run from highest priority to lowest, right items from lowest
 * to highest. Ties keep registration order (Array.prototype.sort is stable).
 */
export function layoutPluginStatusBar(plugins: InstalledPlugin[]): {
  left: PluginStatusBarGroup[];
  right: PluginStatusBarGroup[];
} {
  const groups = groupPluginStatusBarItems(plugins);
  const left = groups.filter((group) => group.side === "left");
  const right = groups.filter((group) => group.side === "right");
  left.sort((a, b) => b.priority - a.priority);
  right.sort((a, b) => a.priority - b.priority);
  return { left, right };
}

/** The host an item uses: the current route's host, else the remembered one, else the first. */
export function selectPluginStatusBarTarget(
  group: PluginStatusBarGroup,
  currentHostId: string | null,
): PluginStatusBarTarget {
  const rememberedHostId = getPreferredPluginContributionHost(pluginScreensHostKey(group.pluginId));
  return (
    group.targets.find((target) => target.plugin.serverId === currentHostId) ??
    group.targets.find((target) => target.plugin.serverId === rememberedHostId) ??
    group.targets[0]
  );
}

/** True when some status bar item has an `agentLabel` that the agent's labels carry. */
export function statusBarOwnsAgentStatusLine(
  plugins: InstalledPlugin[],
  labels: Record<string, string> | undefined,
): boolean {
  if (!labels) return false;
  for (const plugin of plugins) {
    for (const item of plugin.statusBarItems ?? []) {
      if (item.agentLabel !== undefined && Object.hasOwn(labels, item.agentLabel)) return true;
    }
  }
  return false;
}
