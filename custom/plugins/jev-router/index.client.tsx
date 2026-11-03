import type { PluginClientContext } from "@getpaseo/plugin/client";
import {
  JEV_TIMELINE_KIND,
  JEV_TIMELINE_VERSION,
  JevRouteCardDataSchema,
} from "@getpaseo/protocol/jev-router";
import { JevRouteCard } from "./client/route-card";
import { JevRouterSettingsScreen } from "./client/settings-screen";

// Settings > Plugins > jev-router, and the card a routed session gets. The composer icon and the
// draft submit hook live in the app (packages/app/src/jev-router), which reads these same settings.
export default function contribute(client: PluginClientContext) {
  const removeSettings = client.addSettingsScreen({
    id: "router",
    title: "Jev router",
    icon: "Route",
    Component: JevRouterSettingsScreen,
  });
  const removeCard = client.addTimelineRenderer({
    kind: JEV_TIMELINE_KIND,
    version: JEV_TIMELINE_VERSION,
    schema: JevRouteCardDataSchema,
    Component: JevRouteCard,
  });
  return () => {
    removeSettings();
    removeCard();
  };
}
