import { useCallback, useSyncExternalStore } from "react";
import {
  getPanelInstanceAttributes,
  subscribePanelInstanceAttributes,
} from "@/panels/panel-instance-attributes";
import { useDesksStore } from "./desks-store";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useTaskNavigationStore } from "./store";

export function TaskNavigationToggle() {
  const compact = useIsCompactFormFactor();
  const desks = useDesksStore((state) => state.desks);
  const subscribe = useCallback(
    (listener: () => void) => {
      const unsubscribe = desks
        .flatMap((desk) => [...(desk.preview ? [desk.preview] : []), ...desk.tabs])
        .map((tab) =>
          subscribePanelInstanceAttributes(
            { serverId: tab.serverId, workspaceId: tab.workspaceId, tabId: tab.id },
            listener,
          ),
        );
      return () => {
        for (const off of unsubscribe) off();
      };
    },
    [desks],
  );
  const snapshot = useCallback(
    () =>
      desks.some((desk) =>
        [...(desk.preview ? [desk.preview] : []), ...desk.tabs].some(
          (tab) =>
            getPanelInstanceAttributes({
              serverId: tab.serverId,
              workspaceId: tab.workspaceId,
              tabId: tab.id,
            }).modified,
        ),
      ),
    [desks],
  );
  const modified = useSyncExternalStore(subscribe, snapshot, snapshot);
  const enabled = useTaskNavigationStore((state) => state.enabled);
  const setEnabled = useTaskNavigationStore((state) => state.setEnabled);
  let hint = "Use Desks with tasks across projects";
  if (enabled) hint = "Desks and tasks · turn off for the original workspace layout";
  if (enabled && modified) hint = "Save file changes before switching layouts";
  if (compact) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <View style={styles.toggle} testID="task-navigation-toggle">
          <Text style={styles.label}>Tasks</Text>
          <Switch
            value={enabled}
            disabled={enabled && modified}
            onValueChange={setEnabled}
            accessibilityLabel="Use task navigation"
            testID="task-navigation-switch"
          />
        </View>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <Text style={styles.tooltipText}>{hint}</Text>
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
