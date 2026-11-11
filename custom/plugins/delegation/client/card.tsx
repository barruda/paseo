import { useMemo } from "react";
import { Text, View } from "react-native";
import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import {
  formatDelegationModel,
  type DelegationCardData,
  type DelegationWhen,
} from "@getpaseo/protocol/delegation";

// One line at the top of a session that started with the delegation rule, so the session says
// what it was told even after the settings change. In Portuguese, like the Jev router's card.

const WHEN_PT: Record<DelegationWhen, string> = {
  conservative: "modo conservador",
  balanced: "modo equilibrado",
  aggressive: "modo agressivo",
};

export function describeDelegationCard(data: DelegationCardData): string {
  const parts = [
    `implementação vai para ${formatDelegationModel(data.implementerModel)} · ${data.implementerEffort}`,
    WHEN_PT[data.when],
  ];
  if (data.review) parts.push("revisão nesta sessão");
  if (data.searchModel !== "off") parts.push(`busca em ${formatDelegationModel(data.searchModel)}`);
  return `Delegação ligada: ${parts.join(", ")}`;
}

export function DelegationCard({ item, theme }: PluginTimelineItemProps<DelegationCardData>) {
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
    <View style={styles.card} testID="delegation-card">
      <View style={styles.row}>
        <Icon name="Split" size={14} color={theme.colors.foregroundMuted} />
        <Text style={styles.text}>{describeDelegationCard(item.data)}</Text>
      </View>
    </View>
  );
}
