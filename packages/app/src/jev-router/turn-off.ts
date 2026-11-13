// CUSTOM(jev-router): saves the router settings with `enabled: false` from the app side (the card's
// button does the same through the plugin SDK). Used by the Esc 3× restart.

import { settingsRpc } from "@getpaseo/plugin";
import { JEV_ROUTER_SETTINGS_ID, JevRouterSettingsSchema } from "@getpaseo/protocol/jev-router";
import { pluginSettingsKey } from "@/plugins/settings/use-settings";
import type { InstalledPlugin } from "@/plugins/types";

const rpc = settingsRpc(JEV_ROUTER_SETTINGS_ID);

export async function turnJevRouterOff(plugin: InstalledPlugin): Promise<void> {
  const current = rpc.read.output.parse(await plugin.invoke(rpc.read.name, {}));
  if (current.status !== "ready") throw new Error(current.error);
  const values = JevRouterSettingsSchema.parse(current.values);
  if (!values.enabled) return;
  const result = rpc.write.output.parse(
    await plugin.invoke(rpc.write.name, {
      revision: current.revision,
      values: { ...values, enabled: false },
    }),
  );
  if (result.status !== "saved") throw new Error(result.error);
  plugin.queryClient.setQueryData(pluginSettingsKey(JEV_ROUTER_SETTINGS_ID), {
    ...result,
    status: "ready",
  });
}
