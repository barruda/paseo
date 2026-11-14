import { useCallback, useEffect, useState } from "react";
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
import { useFetchQuery } from "@/data/query";
import { useInstalledPlugin } from "@/plugins/registry";
import { pluginSettingsKey } from "@/plugins/settings/use-settings";
import type { InstalledPlugin } from "@/plugins/types";
import { useSessionStore } from "@/stores/session-store";
import { useJevRouterSettingsStore } from "./cycle";
import { describeJevRouter, describeJevUsage, readJevLabels } from "./model";
import { JevRouteChip } from "./route-chip";
import { JevRouterSheet } from "./sheet";

// CUSTOM(jev-router): the composer icon after the critic's, on hosts with the jev-router plugin, in
// drafts and running agents alike, tinted while the router is on. A press turns it on or off; the caret opens the router sheet
// (mode, each mode's models, efforts and thresholds); the tooltip also says what Jev did for
// this session. It shares the plugin settings screen's query cache, so both stay in sync, and hands
// the settings to the ←/→ lock (./cycle.ts). After it, a session Jev moved gets its chip.

// The critic's desaturated blue, so the two tinted icons read as one family.
const ON_ICON_COLOR = "#56677d";

const rpc = settingsRpc(JEV_ROUTER_SETTINGS_ID);

export function JevRouterToggle({
  serverId,
  agentId,
  showIcon = true,
}: {
  serverId: string | null;
  agentId: string | undefined;
  /** CUSTOM(bruno-customizations): off hides the icon only; the lock and the chip keep working. */
  showIcon?: boolean;
}) {
  const plugin = useInstalledPlugin(serverId ?? "", JEV_ROUTER_PLUGIN_ID);
  if (!serverId || !plugin) return null;
  return (
    <PluginJevRouterToggle
      plugin={plugin}
      serverId={serverId}
      agentId={agentId}
      showIcon={showIcon}
    />
  );
}

function PluginJevRouterToggle({
  plugin,
  serverId,
  agentId,
  showIcon,
}: {
  plugin: InstalledPlugin;
  serverId: string;
  agentId: string | undefined;
  showIcon: boolean;
}) {
  const [open, setOpen] = useState(false);
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

  useEffect(() => {
    if (settings) useJevRouterSettingsStore.getState().set(serverId, settings);
  }, [serverId, settings]);

  // CUSTOM(jev-router): the icon (click or Enter) turns the router on or off; the caret opens the
  // sheet.
  const handleToggle = useCallback(async () => {
    if (!ready || !settings) return;
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
      console.warn("[jev-router] toggle failed", error);
      void plugin.queryClient.invalidateQueries({ queryKey: key });
    }
  }, [key, plugin, ready, settings]);
  const handlePress = useCallback(() => void handleToggle(), [handleToggle]);
  const handleOpenSheet = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);

  if (!settings) return null;
  const iconState = describeIconState(settings.enabled);
  const lines = describeJevRouter({
    settings,
    session: readJevLabels(labels),
    usageLine: describeJevUsage(labels),
  });
  return (
    <>
      {showIcon ? (
        <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger asChild triggerRefProp="ref">
            <AgentControlTrigger
              icon={Route}
              iconColor={settings.enabled ? ON_ICON_COLOR : undefined}
              surface="toolbar"
              label="Jev router"
              showToolbarLabel={false}
              onPress={handlePress}
              showCaret
              onChevronPress={handleOpenSheet}
              accessibilityLabel={iconState.label}
              testID="jev-router-toggle"
            />
          </TooltipTrigger>
          <TooltipContent side="top" align="center" offset={8}>
            <Text style={styles.tooltipText}>{[...lines, iconState.hint].join("\n")}</Text>
          </TooltipContent>
        </Tooltip>
      ) : null}
      {agentId ? <JevRouteChip serverId={serverId} agentId={agentId} /> : null}
      {open ? <JevRouterSheet plugin={plugin} onClose={handleClose} /> : null}
    </>
  );
}

function describeIconState(enabled: boolean): { label: string; hint: string } {
  return {
    label: enabled ? "Jev router: on" : "Jev router: off",
    hint: "Click: turn on/off · Caret: settings",
  };
}

const styles = StyleSheet.create((theme) => ({
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.4,
  },
}));
