import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { useSettings, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon, RestartAgentButton } from "@getpaseo/plugin/client/react-native";
import { formatClaudeModel, type JevRouteCardData } from "@getpaseo/protocol/jev-router";
import { routerSettings } from "../shared/settings";

// One line in the chat when Jev started the session on a cheaper model, plus a button that turns
// Jev off and starts the session over on the model the user had picked.

function useStyles(theme: PluginTimelineItemProps["theme"]) {
  return useMemo(
    () => ({
      card: {
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 8,
        backgroundColor: theme.colors.surface1,
        paddingHorizontal: 10,
        paddingVertical: 6,
        gap: 4,
      },
      row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      text: { flex: 1, color: theme.colors.foreground, fontSize: 13 },
      muted: { color: theme.colors.foregroundMuted },
      action: { paddingLeft: 22 },
    }),
    [theme],
  );
}

export function describeRouteCard(data: JevRouteCardData): { pick: string; home: string } {
  const home = formatClaudeModel(data.homeModelId);
  return {
    pick: `${formatClaudeModel(data.pickModelId)} · ${data.pickEffort}`,
    home: data.homeThinkingOptionId ? `${home} · ${data.homeThinkingOptionId}` : home,
  };
}

export function JevRouteCard({
  item,
  theme,
  host,
  agentId,
}: PluginTimelineItemProps<JevRouteCardData>) {
  const data = item.data;
  const styles = useStyles(theme);
  const settings = useSettings(routerSettings);
  const { pick, home } = describeRouteCard(data);
  const turnJevOff = useCallback(async () => {
    if (settings.status !== "ready") throw new Error("Jev router settings are not loaded yet");
    if (!settings.values.enabled) return;
    const saved = await settings.save({ ...settings.values, enabled: false }, settings.revision);
    if (!saved) throw new Error(settings.saveError ?? "Could not turn the Jev router off");
  }, [settings]);
  return (
    <View style={styles.card} testID="jev-route-card">
      <View style={styles.row}>
        <Icon name="Route" size={14} color={theme.colors.foregroundMuted} />
        <Text style={styles.text}>
          Jev começou em {pick} <Text style={styles.muted}>(você escolheu {home})</Text>
        </Text>
      </View>
      {data.prompt !== null ? (
        <View style={styles.action}>
          <RestartAgentButton
            serverId={host.id}
            agentId={agentId}
            label="Ignorar recomendação e reiniciar com modelo selecionado"
            prompt={data.prompt}
            model={data.homeModelId}
            thinkingOptionId={data.homeThinkingOptionId}
            onBeforeRestart={turnJevOff}
            testID="jev-route-restart"
          />
        </View>
      ) : null}
    </View>
  );
}
