// CUSTOM(steer-pending): "pending" badge and cancel button under a steered message Claude has not
// started yet. Kept out of message.tsx so the core edit stays one prop and one element.
import { memo } from "react";
import { Text, View } from "react-native";
import { ArrowUp, Clock, X } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import type { Theme } from "@/styles/theme";

const ThemedClock = withUnistyles(Clock);
const ThemedX = withUnistyles(X);
const ThemedArrowUp = withUnistyles(ArrowUp);

const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

export const SteerPendingRow = memo(function SteerPendingRow({
  active,
  onCancel,
  onInterrupt,
}: {
  active: boolean | undefined;
  onCancel: (() => void) | undefined;
  onInterrupt?: (() => void) | undefined;
}) {
  const { t } = useTranslation();
  if (!active) return null;
  return (
    <View style={styles.row} testID="steer-pending-row">
      <ThemedClock size={12} uniProps={mutedMapping} />
      <Text style={styles.label}>{t("steerPending.pending")}</Text>
      {onInterrupt ? (
        <ToolbarButton
          label={t("steerPending.interrupt")}
          onPress={onInterrupt}
          compact
          testID="steer-pending-interrupt"
        >
          <ThemedArrowUp size={14} uniProps={mutedMapping} />
        </ToolbarButton>
      ) : null}
      {onCancel ? (
        <ToolbarButton
          label={t("steerPending.cancel")}
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
