import { defineSettings, defineRpc } from "@getpaseo/plugin";
import {
  JEV_ROUTER_RPC,
  JEV_ROUTER_SETTINGS_ID,
  JevRouteInputSchema,
  JevRouteOutputSchema,
  JevUpgradeInputSchema,
  JevUpgradeOutputSchema,
  JevRouterSettingsSchema,
} from "@getpaseo/protocol/jev-router";

export const routerSettings = defineSettings({
  id: JEV_ROUTER_SETTINGS_ID,
  scope: "host",
  version: 1,
  schema: JevRouterSettingsSchema,
});

export const routeRpc = defineRpc({
  name: JEV_ROUTER_RPC.route,
  input: JevRouteInputSchema,
  output: JevRouteOutputSchema,
});

export const upgradeRpc = defineRpc({
  name: JEV_ROUTER_RPC.upgrade,
  input: JevUpgradeInputSchema,
  output: JevUpgradeOutputSchema,
});
