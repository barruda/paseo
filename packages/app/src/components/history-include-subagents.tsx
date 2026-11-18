import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import { PressHighlight } from "@/components/ui/press-highlight";
import { Check } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { Theme } from "@/styles/theme";

// CUSTOM(history-subagents-toggle): "Include sub-agents" checkbox under the History search
// field. Off by default. English only, like the other custom surfaces.

const ThemedCheck = withUnistyles(Check, (theme: Theme) => ({
  color: theme.colors.accentForeground,
}));

export function HistoryIncludeSubagents({
  value,
  onValueChange,
}: {
  value: boolean;
  onValueChange: (value: boolean) => void;
}) {
  const toggle = useCallback(() => onValueChange(!value), [onValueChange, value]);
  const accessibilityState = useMemo(() => ({ checked: value }), [value]);
  const boxStyle = useMemo(() => [styles.box, value ? styles.boxChecked : null], [value]);

  return (
    <View style={styles.container}>
      <PressHighlight
        style={styles.row}
        onPress={toggle}
        accessibilityRole="checkbox"
        accessibilityLabel="Include sub-agents"
        accessibilityState={accessibilityState}
        testID="sessions-include-subagents"
      >
        <View style={boxStyle}>{value ? <ThemedCheck size={12} /> : null}</View>
        <Text style={styles.label}>Include sub-agents</Text>
      </PressHighlight>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    alignItems: "flex-start",
    paddingHorizontal: {
      xs: theme.spacing[3],
      md: theme.spacing[6],
    },
    paddingTop: theme.spacing[2],
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: 2,
  },
  box: {
    width: 16,
    height: 16,
    borderRadius: theme.borderRadius.sm,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    alignItems: "center",
    justifyContent: "center",
  },
  boxChecked: {
    backgroundColor: theme.colors.accent,
    borderColor: theme.colors.accent,
  },
  label: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
}));
