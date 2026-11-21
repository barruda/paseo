import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Shortcut } from "@/components/ui/shortcut";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useHardwareKeyboardPresent } from "@/keyboard";

/** The model picker's shortcut, shown at the end of the composer controls so it's discoverable. */
export function ModelPickerShortcutChip() {
  const keys = useShortcutKeys("open-model-picker");
  const available = useHardwareKeyboardPresent();
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
