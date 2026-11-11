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
import { describeJevRouter, readJevLabels } from "./model";
import { JevRouteChip } from "./route-chip";
import { JevRouterSheet } from "./sheet";
import { useJevSkipNextStore } from "./skip-next";

// CUSTOM(jev-router): the composer icon after the critic's, on hosts with the jev-router plugin, in
// drafts and running agents alike, tinted while the router is on. A press opens the router sheet
// (on/off, mode, each mode's models, efforts and thresholds); the tooltip also says what Jev did for
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

  // CUSTOM(jev-router): the icon skips Jev for the next new agent only (it comes back on by
  // itself); the caret opens the sheet, the only place that turns the router off for good. With
  // the router off, the icon opens the sheet too.
  const skipNext = useJevSkipNextStore((state) => state.byServer[serverId] === true);
  const handlePress = useCallback(() => {
    if (settings?.enabled) useJevSkipNextStore.getState().toggle(serverId);
    else setOpen(true);
  }, [serverId, settings?.enabled]);
  const handleOpenSheet = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);

  if (!settings) return null;
  const iconState = describeIconState(settings.enabled, skipNext);
  const lines = describeJevRouter({ settings, session: readJevLabels(labels) });
  return (
    <>
      {showIcon ? (
        <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
          <TooltipTrigger asChild triggerRefProp="ref">
            <AgentControlTrigger
              icon={Route}
              iconColor={settings.enabled && !skipNext ? ON_ICON_COLOR : undefined}
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

function describeIconState(enabled: boolean, skipNext: boolean): { label: string; hint: string } {
  if (!enabled) return { label: "Jev router: off", hint: "Turn it on in the settings (caret)" };
  if (skipNext) {
    return {
      label: "Jev router: skipped for the next new agent",
      hint: "Skipped for the next new agent only. Click to route it again.",
    };
  }
  return {
    label: "Jev router: on",
    hint: "Click: skip Jev for the next new agent · Caret: settings",
  };
}

const styles = StyleSheet.create((theme) => ({
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.4,
  },
}));
