// CUSTOM(telus-sync): the Settings screen lives in client/SettingsScreen.tsx.
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { TelusSyncSettingsScreen } from "./client/SettingsScreen";

/**
 * A Settings screen on the Paseo Personal daemon. The Telus daemon also has the plugin installed;
 * there the screen explains that the sync only runs from Personal.
 */
export default function contribute(client: PluginClientContext) {
  const removeSettings = client.addSettingsScreen({
    id: "sync",
    title: "Sincronizar com Paseo Telus",
    icon: "ArrowLeftRight",
    Component: TelusSyncSettingsScreen,
  });
  return () => {
    removeSettings();
  };
}
