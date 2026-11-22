import { Pressable, StyleSheet, Text, View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import type { Card } from "../shared/model";
import { shortDate } from "./board-utils";
import type { strings } from "./strings";

/** A card archived off the board, shown dimmed in the column it was archived from. */
export function ArchivedBoardCard({
  card,
  t,
  theme,
  disabled,
  onOpen,
  onRestore,
}: {
  card: Card;
  t: ReturnType<typeof strings>;
  theme: PluginSurfaceProps["theme"];
  disabled: boolean;
  onOpen(): void;
  onRestore(): void;
}) {
  const muted = theme.colors.foregroundMuted;
  return (
    <View
      testID={`workboard-archived-${card.id}`}
      style={[
        styles.card,
        {
          backgroundColor: theme.colors.surface1,
          borderColor: theme.colors.border,
        },
      ]}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={card.title}
        onPress={onOpen}
        style={[styles.body, styles.dimmed]}
      >
        <Text style={[styles.title, { color: theme.colors.foreground }]}>
          {card.number > 0 ? `#${card.number} ` : ""}
          {card.title}
        </Text>
        <Text style={{ color: muted }}>{card.projectName}</Text>
        <View style={styles.meta}>
          <Text style={[styles.badge, { color: muted, borderColor: muted }]}>
            {t.archivedBadge}
          </Text>
          {card.archived?.archivedAt ? (
            <Text style={{ color: muted }}>
              {shortDate(card.archived.archivedAt, t.locale)}
            </Text>
          ) : null}
        </View>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={onRestore}
        style={[styles.restore, { borderColor: theme.colors.border }]}
      >
        <Text style={{ color: theme.colors.foreground }}>{t.restoreTask}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 9,
    paddingVertical: 8,
    gap: 6,
  },
  body: { gap: 4 },
  dimmed: { opacity: 0.55 },
  title: { fontWeight: "600" },
  meta: { flexDirection: "row", alignItems: "center", gap: 8 },
  badge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 5,
    fontSize: 11,
  },
  restore: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
});
