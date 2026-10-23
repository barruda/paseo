// CUSTOM(bottom-panel-expand): the reverse of the ⌄⌄ collapse button. While the bottom panel is
// closed (hidden, or not created yet), a ⌃⌃ button floats at the bottom of the workspace, 100px
// right of the left sidebar, level with the sidebar's footer icons. It dispatches the same
// keyboard action as Ctrl+J, so it shows a hidden panel or creates one.
import { ChevronsUp } from "lucide-react-native";
import { useCallback } from "react";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { mutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { supportsDesktopPaneSplits, useIsCompactFormFactor } from "@/constants/layout";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useKeyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher-context";
import { findPaneById, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { BOTTOM_PANEL_PANE_ID } from "./bottom-panel";

const ThemedChevronsUp = withUnistyles(ChevronsUp);
const SIDEBAR_GAP = 100;

function useIsBottomPanelClosed(workspaceKey: string | null): boolean {
  return useWorkspaceLayoutStore((state) => {
    if (!workspaceKey) return false;
    const layout = state.layoutByWorkspace[workspaceKey];
    const pane = layout ? findPaneById(layout.root, BOTTOM_PANEL_PANE_ID) : null;
    return !pane || pane.hidden === true;
  });
}

export function BottomPanelExpandButton({ workspaceKey }: { workspaceKey: string | null }) {
  const isClosed = useIsBottomPanelClosed(workspaceKey);
  const isCompact = useIsCompactFormFactor();
  const keyboardActionDispatcher = useKeyboardActionDispatcher();
  const shortcutKeys = useShortcutKeys("toggle-bottom-panel");
  const handlePress = useCallback(() => {
    keyboardActionDispatcher.dispatch({ id: "workspace.bottom-panel.toggle", scope: "workspace" });
  }, [keyboardActionDispatcher]);
  if (!isClosed || isCompact || !supportsDesktopPaneSplits()) return null;
  return (
    <View style={styles.float} pointerEvents="box-none">
      <ToolbarButton
        label="Show bottom panel"
        shortcut={shortcutKeys}
        tooltipSide="top"
        testID="bottom-panel-expand"
        onPress={handlePress}
      >
        <ThemedChevronsUp size={21} uniProps={mutedIconColorMapping} />
      </ToolbarButton>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  float: {
    position: "absolute",
    left: SIDEBAR_GAP,
    // Level with the sidebar footer's icons: its padding plus half the size difference between
    // its 28px icon buttons and this 20px one.
    bottom: theme.spacing[1.5] + 4,
    zIndex: 40,
  },
}));
