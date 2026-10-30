import { ChevronsLeft, ChevronsRight, PanelRight } from "lucide-react-native";
import { type StyleProp, type ViewStyle } from "react-native";
import { withUnistyles } from "react-native-unistyles";
import { HeaderToggleButton } from "@/components/headers/header-toggle-button";
import { SidebarCloseButton } from "@/components/headers/sidebar-close-button";
import {
  extraMutedIconColorMapping,
  iconButtonChromeGlyphSize,
  mutedIconColorMapping,
} from "@/components/ui/icon-button-chrome";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import type { ShortcutKey } from "@/utils/format-shortcut";

const ThemedPanelRight = withUnistyles(PanelRight);
const ThemedChevronsLeft = withUnistyles(ChevronsLeft);
const ThemedChevronsRight = withUnistyles(ChevronsRight);

export const EXPLORER_TOGGLE_KEYS: ShortcutKey[] = ["mod", "E"];

interface WorkspaceExplorerToggleProps {
  onPress: () => void;
  label: string;
  tooltipLabel: string;
  tooltipKeys: ShortcutKey[];
  accessibilityState: { expanded: boolean };
  mobile: boolean;
  style?: StyleProp<ViewStyle>;
}

export type WorkspaceExplorerToggleOwner = "mobile" | "header" | "window";

export function resolveWorkspaceExplorerToggleOwner({
  isMobile,
  hasMacTrafficLights,
}: {
  isMobile: boolean;
  hasMacTrafficLights: boolean;
}): WorkspaceExplorerToggleOwner {
  if (isMobile) return "mobile";
  return hasMacTrafficLights ? "window" : "header";
}

export function WorkspaceExplorerToggle({
  onPress,
  label,
  tooltipLabel,
  tooltipKeys,
  accessibilityState,
  mobile,
  style,
}: WorkspaceExplorerToggleProps) {
  return (
    <HeaderToggleButton
      testID="workspace-explorer-toggle"
      onPress={onPress}
      tooltipLabel={tooltipLabel}
      tooltipKeys={tooltipKeys}
      tooltipSide="left"
      style={style}
      accessible
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={accessibilityState}
    >
      <ThemedPanelRight
        size={iconButtonChromeGlyphSize("large")}
        strokeWidth={1.5}
        uniProps={mobile ? mutedIconColorMapping : extraMutedIconColorMapping}
      />
    </HeaderToggleButton>
  );
}

interface DesktopWorkspaceExplorerToggleProps extends Omit<WorkspaceExplorerToggleProps, "mobile"> {
  owner: WorkspaceExplorerToggleOwner;
}

export function WorkspaceExplorerSidebarToggle({
  owner,
  ...toggleProps
}: DesktopWorkspaceExplorerToggleProps) {
  if (owner === "header") return null;
  if (owner === "mobile") {
    // The compact Explorer is an overlay like the compact agent list, so it closes with the same X.
    return (
      <SidebarCloseButton
        label={toggleProps.label}
        onPress={toggleProps.onPress}
        testID="workspace-explorer-toggle"
        accessibilityState={toggleProps.accessibilityState}
      />
    );
  }
  return <WorkspaceExplorerToggle {...toggleProps} mobile={false} />;
}

// CUSTOM(explorer-toggle-tab-row): on desktop the toggle sits at the right end of the top-right
// pane's tab row instead of the crowded header. << opens the Explorer, >> closes it.
export function WorkspaceTabRowExplorerToggle({
  owner,
  onPress,
  label,
  tooltipKeys,
  accessibilityState,
}: DesktopWorkspaceExplorerToggleProps) {
  if (owner === "mobile" || (owner === "window" && accessibilityState.expanded)) return null;
  const Icon = accessibilityState.expanded ? ThemedChevronsRight : ThemedChevronsLeft;
  return (
    <ToolbarButton
      label={label}
      shortcut={[tooltipKeys]}
      tooltipSide="left"
      testID="workspace-explorer-toggle"
      onPress={onPress}
    >
      <Icon size={21} uniProps={mutedIconColorMapping} />
    </ToolbarButton>
  );
}
