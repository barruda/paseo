import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Shortcut } from "@/components/ui/shortcut";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useKeyboardShortcutsAvailable } from "@/keyboard/availability";

/** The model picker's shortcut, shown at the end of the composer controls so it's discoverable. */
export function ModelPickerShortcutChip() {
  const keys = useShortcutKeys("open-model-picker");
  const available = useKeyboardShortcutsAvailable();
  if (!keys || !available) return null;
  return (
    <View style={styles.chip} testID="model-picker-shortcut-chip">
      <Shortcut chord={keys} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  chip: {
    flexShrink: 0,
    marginLeft: theme.spacing[1],
    justifyContent: "center",
  },
}));
