// CUSTOM(changes-diff-tab): the "Open in different tabs" checkbox in the Changes tree toolbar.
import { Pressable, Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Check } from "lucide-react-native";
import type { Theme } from "@/styles/theme";
import { useDiffTabsStore } from "./store";

const ThemedCheck = withUnistyles(Check);
const markColorMapping = (theme: Theme) => ({ color: theme.colors.accentForeground });

export function OpenInNewTabsToggle() {
  const checked = useDiffTabsStore((state) => state.openInNewTabs);
  const toggle = useDiffTabsStore((state) => state.toggleOpenInNewTabs);
  return (
    <Pressable
      onPress={toggle}
      accessibilityRole="checkbox"
      aria-checked={checked}
      testID="changes-open-in-new-tabs"
      style={styles.row}
    >
      <View style={[styles.box, checked && styles.boxChecked]}>
        {checked ? <ThemedCheck size={11} strokeWidth={3} uniProps={markColorMapping} /> : null}
      </View>
      <Text style={styles.label} numberOfLines={1}>
        Open in different tabs
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    flexShrink: 1,
    minWidth: 0,
    marginRight: theme.spacing[1],
  },
  box: {
    width: 14,
    height: 14,
    borderRadius: theme.borderRadius.sm,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.foregroundMuted,
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
    flexShrink: 1,
  },
}));
