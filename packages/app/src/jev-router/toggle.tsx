import { useCallback, useState } from "react";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Route } from "lucide-react-native";
import { settingsRpc } from "@getpaseo/plugin";
import {
  JEV_ROUTER_PLUGIN_ID,
  JEV_ROUTER_SETTINGS_ID,
  JevRouterSettingsSchema,
} from "@getpaseo/protocol/jev-router";
import { AgentControlTrigger } from "@/composer/agent-controls/control";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/contexts/toast-context";
import { useFetchQuery } from "@/data/query";
import { useInstalledPlugin } from "@/plugins/registry";
import { pluginSettingsKey } from "@/plugins/settings/use-settings";
import type { InstalledPlugin } from "@/plugins/types";
import { useSessionStore } from "@/stores/session-store";
import { toErrorMessage } from "@/utils/error-messages";
import { describeJevRouter, readJevLabels } from "./model";

// CUSTOM(jev-router): the composer icon after the critic's, on hosts with the jev-router plugin, in
// drafts and running agents alike. A press turns the router on (tinted) or off (outline); the
// tooltip also says what Jev did for this session. It shares the plugin settings screen's query
// cache, so both stay in sync.

// The critic's desaturated blue, so the two tinted icons read as one family.
const ON_ICON_COLOR = "#56677d";

const rpc = settingsRpc(JEV_ROUTER_SETTINGS_ID);

export function JevRouterToggle({
  serverId,
  agentId,
}: {
  serverId: string | null;
  agentId: string | undefined;
}) {
  const plugin = useInstalledPlugin(serverId ?? "", JEV_ROUTER_PLUGIN_ID);
  if (!serverId || !plugin) return null;
  return <PluginJevRouterToggle plugin={plugin} serverId={serverId} agentId={agentId} />;
}

function PluginJevRouterToggle({
  plugin,
  serverId,
  agentId,
}: {
  plugin: InstalledPlugin;
  serverId: string;
  agentId: string | undefined;
}) {
  const toast = useToast();
  const [saving, setSaving] = useState(false);
  const key = pluginSettingsKey(JEV_ROUTER_SETTINGS_ID);
  // Same key and client as the plugin's settings screen; its saves invalidate this too.
  const query = useFetchQuery(
    {
      queryKey: key,
      queryFn: async () => rpc.read.output.parse(await plugin.invoke(rpc.read.name, {})),
      dataShape: "value",
      staleTimeMs: 60_000,
      retry: false,
    },
    plugin.queryClient,
  );
  const labels = useSessionStore((state) =>
    agentId ? state.sessions[serverId]?.agents.get(agentId)?.labels : undefined,
  );
  const ready = query.data?.status === "ready" ? query.data : null;
  const parsed = ready ? JevRouterSettingsSchema.safeParse(ready.values) : null;
  const settings = parsed?.success ? parsed.data : null;

  const handlePress = useCallback(async () => {
    if (!ready || !settings || saving) return;
    setSaving(true);
    try {
      const result = rpc.write.output.parse(
        await plugin.invoke(rpc.write.name, {
          revision: ready.revision,
          values: { ...settings, enabled: !settings.enabled },
        }),
      );
      if (result.status !== "saved") throw new Error(result.error);
      plugin.queryClient.setQueryData(key, { ...result, status: "ready" });
    } catch (error) {
      toast.error(`Jev router: ${toErrorMessage(error)}`);
      void plugin.queryClient.invalidateQueries({ queryKey: key });
    } finally {
      setSaving(false);
    }
  }, [key, plugin, ready, saving, settings, toast]);

  if (!settings) return null;
  const lines = describeJevRouter({ settings, session: readJevLabels(labels) });
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild triggerRefProp="ref">
        <AgentControlTrigger
          icon={Route}
          iconColor={settings.enabled ? ON_ICON_COLOR : undefined}
          surface="toolbar"
          label="Jev router"
          showToolbarLabel={false}
          onPress={handlePress}
          accessibilityLabel={settings.enabled ? "Jev router: on" : "Jev router: off"}
          testID="jev-router-toggle"
        />
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <Text style={styles.tooltipText}>{lines.join("\n")}</Text>
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.4,
  },
}));
