// CUSTOM(bruno-plugin-groups): Bruno's own plugins live in the repo's custom/plugins/<name>.
import type { PluginListItem } from "@getpaseo/protocol/messages";

const BRUNO_PLUGIN_DIRECTORY = /\/custom\/plugins\/[^/]+\/?$/;

export function isBrunoPlugin(plugin: Pick<PluginListItem, "installation">): boolean {
  const identity = plugin.installation?.identity;
  return identity?.kind === "directory" && BRUNO_PLUGIN_DIRECTORY.test(identity.path);
}

export function pluginDisplayName(plugin: Pick<PluginListItem, "id" | "installation">): string {
  return isBrunoPlugin(plugin) ? `Bruno/${plugin.id}` : plugin.id;
}
