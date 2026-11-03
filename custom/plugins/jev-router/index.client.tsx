import type { PluginClientContext } from "@getpaseo/plugin/client";
import { JevRouterSettingsScreen } from "./client/settings-screen";

// Settings > Plugins > jev-router. The composer icon and the draft submit hook live in the app
// (packages/app/src/jev-router), which reads these same settings.
export default function contribute(client: PluginClientContext) {
  return client.addSettingsScreen({
    id: "router",
    title: "Jev router",
    icon: "Route",
    Component: JevRouterSettingsScreen,
  });
}
