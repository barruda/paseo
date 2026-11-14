import { useMemo } from "react";
import { Text, View } from "react-native";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import type { JevUpgradeCardData } from "@getpaseo/protocol/jev-router";

// One line in the chat when Jev raised the session's effort before a follow-up.

const WHY: Record<string, string> = { hard: "pedido difícil" };

export function describeUpgradeCard(data: JevUpgradeCardData): string {
  const reason = WHY[data.why] ?? "pedido difícil";
  return `Jev subiu o effort: ${data.fromEffort} → ${data.toEffort} (${reason})`;
}

export function JevUpgradeCard({ item, theme }: PluginTimelineItemProps<JevUpgradeCardData>) {
  const styles = useMemo(
    () => ({
      card: {
        borderWidth: 1,
        borderColor: theme.colors.border,
        borderRadius: 8,
        backgroundColor: theme.colors.surface1,
        paddingHorizontal: 10,
        paddingVertical: 6,
      },
      row: { flexDirection: "row" as const, alignItems: "center" as const, gap: 8 },
      text: { flex: 1, color: theme.colors.foreground, fontSize: 13 },
    }),
    [theme],
  );
  return (
    <View style={styles.card} testID="jev-upgrade-card">
      <View style={styles.row}>
        <Icon name="Route" size={14} color={theme.colors.foregroundMuted} />
        <Text style={styles.text}>{describeUpgradeCard(item.data)}</Text>
      </View>
    </View>
  );
}
