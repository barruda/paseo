// CUSTOM(bottom-panel-collapse): a ⌄⌄ button before the bottom panel's tabs hides the panel, like
// Ctrl+J. It dispatches the same keyboard action, so the workspace screen or the Desk handles it.
import { ChevronsDown } from "lucide-react-native";
import { useCallback } from "react";
import { withUnistyles } from "react-native-unistyles";
import { mutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useKeyboardActionDispatcher } from "@/keyboard/keyboard-action-dispatcher-context";

const ThemedChevronsDown = withUnistyles(ChevronsDown);

export function BottomPanelCollapseButton() {
  const keyboardActionDispatcher = useKeyboardActionDispatcher();
  const shortcutKeys = useShortcutKeys("toggle-bottom-panel");
  const handlePress = useCallback(() => {
    keyboardActionDispatcher.dispatch({ id: "workspace.bottom-panel.toggle", scope: "workspace" });
  }, [keyboardActionDispatcher]);
  return (
    <ToolbarButton
      label="Hide bottom panel"
      shortcut={shortcutKeys}
      tooltipSide="top"
      testID="bottom-panel-collapse"
      onPress={handlePress}
    >
      <ThemedChevronsDown size={21} uniProps={mutedIconColorMapping} />
    </ToolbarButton>
  );
}
