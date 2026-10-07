import type { PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/react-native";
import { useMemo } from "react";
import { Text, View } from "react-native";
import type { TaskNoteTimelineData } from "../shared/tasks";

/** One muted line in the chat confirming what a task command did. */
export function TaskNote({ item, theme }: PluginTimelineItemProps<TaskNoteTimelineData>) {
  const styles = useMemo(
    () => ({
      row: {
        flexDirection: "row" as const,
        alignItems: "center" as const,
        gap: 6,
        paddingVertical: 2,
      },
      text: { flex: 1, color: theme.colors.foregroundMuted, fontSize: 12 },
    }),
    [theme],
  );
  return (
    <View style={styles.row}>
      <Icon name="ListTodo" size={13} color={theme.colors.foregroundMuted} />
      <Text style={styles.text}>{item.data.text}</Text>
    </View>
  );
}
