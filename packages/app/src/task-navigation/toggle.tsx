import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useTaskNavigationStore } from "./store";

export function TaskNavigationToggle() {
  const compact = useIsCompactFormFactor();
  const enabled = useTaskNavigationStore((state) => state.enabled);
  const setEnabled = useTaskNavigationStore((state) => state.setEnabled);
  if (compact) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <View style={styles.toggle} testID="task-navigation-toggle">
          <Text style={styles.label}>Tasks</Text>
          <Switch
            value={enabled}
            onValueChange={setEnabled}
            accessibilityLabel="Use task navigation"
            testID="task-navigation-switch"
          />
        </View>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <Text style={styles.tooltipText}>
          {enabled
            ? "Task navigation · turn off for the workspace sidebar"
            : "Switch to tasks and crews across workspaces"}
        </Text>
      </TooltipContent>
    </Tooltip>
  );
}
const styles = StyleSheet.create((theme) => ({
  toggle: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingHorizontal: theme.spacing[2],
  },
  tooltipText: { color: theme.colors.foreground, fontSize: theme.fontSize.sm },
  label: { fontSize: theme.fontSize.sm, color: theme.colors.foregroundMuted },
}));
