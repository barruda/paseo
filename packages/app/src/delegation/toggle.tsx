import { useCallback, useState } from "react";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Split } from "lucide-react-native";
import { settingsRpc } from "@getpaseo/plugin";
import {
  DELEGATION_PLUGIN_ID,
  DELEGATION_SETTINGS_ID,
  DELEGATION_WHEN_LABELS,
  DelegationSettingsSchema,
  formatDelegationModel,
  formatPaseoSubagentProvider,
  type DelegationSettings,
} from "@getpaseo/protocol/delegation";
import { AgentControlTrigger } from "@/composer/agent-controls/control";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useFetchQuery } from "@/data/query";
import { useInstalledPlugin } from "@/plugins/registry";
import { pluginSettingsKey } from "@/plugins/settings/use-settings";
import type { InstalledPlugin } from "@/plugins/types";
import { toErrorMessage } from "@/utils/error-messages";
import { DelegationSheet } from "./sheet";

// CUSTOM(delegation): the composer icon after the Jev router's, on hosts with the delegation
// plugin, tinted while delegation is on. A press turns it on or off for the host's new sessions;
// the caret opens the sheet (implementer model and effort, when to delegate, review, search).

// The critic's and Jev's desaturated blue, so the tinted icons read as one family.
const ON_ICON_COLOR = "#56677d";

const rpc = settingsRpc(DELEGATION_SETTINGS_ID);

export function DelegationToggle({ serverId }: { serverId: string | null }) {
  const plugin = useInstalledPlugin(serverId ?? "", DELEGATION_PLUGIN_ID);
  if (!serverId || !plugin) return null;
  return <PluginDelegationToggle plugin={plugin} />;
}

const SUBAGENT_CONTEXT_LINES = {
  project: "Subagents: project CLAUDE.md only",
  none: "Subagents: no CLAUDE.md",
} as const;

export function describeDelegation(settings: DelegationSettings): string[] {
  const subagents =
    settings.subagentContext === "full" ? [] : [SUBAGENT_CONTEXT_LINES[settings.subagentContext]];
  const cache = settings.subagentCacheTtl === "1h" ? ["Subagents: 1 hour cache"] : [];
  return [...describeDelegationRule(settings), ...subagents, ...cache];
}

function describePaseoSubagent(settings: DelegationSettings): string {
  const model = settings.paseoModel
    ? formatPaseoSubagentProvider(settings.paseoProvider, settings.paseoModel)
    : `${settings.paseoProvider} (default model)`;
  return settings.paseoThinkingOptionId ? `${model} · ${settings.paseoThinkingOptionId}` : model;
}

function describeDelegationRule(settings: DelegationSettings): string[] {
  if (!settings.enabled) return ["Delegation: off"];
  const implementer =
    settings.implementerRunner === "paseo"
      ? `a Paseo subagent on ${describePaseoSubagent(settings)}`
      : `${formatDelegationModel(settings.implementerModel)} · ${settings.implementerEffort}`;
  return [
    `Delegation: on. New Opus/Fable sessions hand the code to ${implementer} (${DELEGATION_WHEN_LABELS[settings.when].toLowerCase()}).`,
    "Applies when a session is created; open sessions keep what they started with.",
  ];
}

function PluginDelegationToggle({ plugin }: { plugin: InstalledPlugin }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = pluginSettingsKey(DELEGATION_SETTINGS_ID);
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
  const ready = query.data?.status === "ready" ? query.data : null;
  const parsed = ready ? DelegationSettingsSchema.safeParse(ready.values) : null;
  const settings = parsed?.success ? parsed.data : null;
  const revision = ready?.revision ?? null;

  const toggle = useCallback(async () => {
    if (!settings || !revision) return;
    try {
      const result = rpc.write.output.parse(
        await plugin.invoke(rpc.write.name, {
          revision,
          values: { ...settings, enabled: !settings.enabled },
        }),
      );
      if (result.status !== "saved") throw new Error(result.error);
      plugin.queryClient.setQueryData(key, { ...result, status: "ready" });
      setError(null);
    } catch (cause) {
      // A save from another client moved the revision: read it again for the next press.
      setError(toErrorMessage(cause));
      void plugin.queryClient.invalidateQueries({ queryKey: key });
    }
  }, [key, plugin, revision, settings]);
  const handlePress = useCallback(() => void toggle(), [toggle]);
  const handleOpenSheet = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);

  if (!settings) return null;
  const lines = describeDelegation(settings);
  const hint = settings.enabled
    ? "Click: turn off · Caret: settings"
    : "Click: turn on · Caret: settings";
  return (
    <>
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild triggerRefProp="ref">
          <AgentControlTrigger
            icon={Split}
            iconColor={settings.enabled ? ON_ICON_COLOR : undefined}
            surface="toolbar"
            label="Delegation"
            showToolbarLabel={false}
            onPress={handlePress}
            showCaret
            onChevronPress={handleOpenSheet}
            accessibilityLabel={settings.enabled ? "Delegation: on" : "Delegation: off"}
            testID="delegation-toggle"
          />
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <Text style={styles.tooltipText}>
            {[...lines, ...(error ? [`Could not save: ${error}`] : []), hint].join("\n")}
          </Text>
        </TooltipContent>
      </Tooltip>
      {open ? <DelegationSheet plugin={plugin} onClose={handleClose} /> : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.4,
  },
}));
