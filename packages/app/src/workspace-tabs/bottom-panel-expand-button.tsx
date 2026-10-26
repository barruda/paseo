// CUSTOM(bottom-panel-expand): the reverse of the ⌄⌄ collapse button. While the bottom panel is
// closed (hidden, or not created yet), a ⌃⌃ button floats at the bottom of the workspace or the
// Desk, 100px right of the left sidebar, level with the sidebar's footer icons. It dispatches the
// same keyboard action as Ctrl+J, which each screen handles for its own layout.
// CUSTOM(bottom-panel-toggle-inline): while an agent status line is on screen, the toggle sits left
// of its summary instead (⌃⌃ to show, ⌄⌄ to hide), and the floating button steps aside.
import { ChevronsDown, ChevronsUp } from "lucide-react-native";
import { useCallback, useEffect } from "react";
import { create } from "zustand";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { mutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { supportsDesktopPaneSplits, useIsCompactFormFactor } from "@/constants/layout";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useKeyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher-context";
import { findPaneById, type WorkspaceLayout } from "@/stores/workspace-layout-store";
import { BOTTOM_PANEL_PANE_ID } from "./bottom-panel";

const ThemedChevronsUp = withUnistyles(ChevronsUp);
const ThemedChevronsDown = withUnistyles(ChevronsDown);
const SIDEBAR_GAP = 100;

interface BottomPanelToggleState {
  /** null where the bottom panel isn't offered (compact layout, no pane splits, no layout). */
  panel: "open" | "closed" | null;
  /** Inline toggles on screen; while any is, the floating button hides. */
  inlineCount: number;
}
const useBottomPanelToggleStore = create<BottomPanelToggleState>()(() => ({
  panel: null,
  inlineCount: 0,
}));

function useToggleBottomPanel() {
  const keyboardActionDispatcher = useKeyboardActionDispatcher();
  return useCallback(() => {
    keyboardActionDispatcher.dispatch({ id: "workspace.bottom-panel.toggle", scope: "workspace" });
  }, [keyboardActionDispatcher]);
}

/** The bottom panel toggle that sits left of the agent status line's summary. */
export function BottomPanelInlineToggle() {
  const panel = useBottomPanelToggleStore((state) => state.panel);
  const shortcutKeys = useShortcutKeys("toggle-bottom-panel");
  const handlePress = useToggleBottomPanel();
  const visible = panel !== null;
  useEffect(() => {
    if (!visible) return;
    useBottomPanelToggleStore.setState((state) => ({ inlineCount: state.inlineCount + 1 }));
    return () =>
      useBottomPanelToggleStore.setState((state) => ({ inlineCount: state.inlineCount - 1 }));
  }, [visible]);
  if (!visible) return null;
  const isOpen = panel === "open";
  return (
    <ToolbarButton
      label={isOpen ? "Hide bottom panel" : "Show bottom panel"}
      shortcut={shortcutKeys}
      tooltipSide="top"
      testID="bottom-panel-inline-toggle"
      onPress={handlePress}
    >
      {isOpen ? (
        <ThemedChevronsDown size={14} uniProps={mutedIconColorMapping} />
      ) : (
        <ThemedChevronsUp size={14} uniProps={mutedIconColorMapping} />
      )}
    </ToolbarButton>
  );
}

/** `layout` is the screen's pane layout, the workspace's or the Desk's. */
export function BottomPanelExpandButton({ layout }: { layout: WorkspaceLayout | null }) {
  const pane = layout ? findPaneById(layout.root, BOTTOM_PANEL_PANE_ID) : null;
  const isClosed = layout !== null && (!pane || pane.hidden === true);
  const isCompact = useIsCompactFormFactor();
  const shortcutKeys = useShortcutKeys("toggle-bottom-panel");
  const handlePress = useToggleBottomPanel();
  const available = layout !== null && !isCompact && supportsDesktopPaneSplits();
  let panel: BottomPanelToggleState["panel"] = null;
  if (available) panel = isClosed ? "closed" : "open";
  useEffect(() => {
    useBottomPanelToggleStore.setState({ panel });
  }, [panel]);
  useEffect(() => () => useBottomPanelToggleStore.setState({ panel: null }), []);
  const hasInline = useBottomPanelToggleStore((state) => state.inlineCount > 0);
  if (panel !== "closed" || hasInline) return null;
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
