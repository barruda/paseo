// CUSTOM(steer-pending): "pending" badge and cancel button under a steered message Claude has not
// started yet. Kept out of message.tsx so the core edit stays one prop and one element.
import { memo } from "react";
import { Text, View } from "react-native";
import { Clock, X } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import type { Theme } from "@/styles/theme";

const ThemedClock = withUnistyles(Clock);
const ThemedX = withUnistyles(X);

const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export const SteerPendingRow = memo(function SteerPendingRow({
  active,
  onCancel,
}: {
  active: boolean | undefined;
  onCancel: (() => void) | undefined;
}) {
  if (!active) return null;
  return (
    <View style={styles.row} testID="steer-pending-row">
      <ThemedClock size={12} uniProps={mutedMapping} />
      <Text style={styles.label}>pending</Text>
      {onCancel ? (
        <ToolbarButton
          label="Cancel message"
          onPress={onCancel}
          compact
          testID="steer-pending-cancel"
        >
          <ThemedX size={14} uniProps={mutedMapping} />
        </ToolbarButton>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create((theme) => ({
  row: {
    alignSelf: "flex-end",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    marginTop: theme.spacing[1],
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: 12,
  },
}));
