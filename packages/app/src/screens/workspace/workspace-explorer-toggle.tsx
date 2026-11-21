import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ChevronsLeft, ChevronsRight, PanelRight } from "lucide-react-native";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { WINDOW_NO_DRAG_DATASET } from "@/components/desktop/titlebar-drag-region";
import { HeaderToggleButton, headerIconSlotStyle } from "@/components/headers/header-toggle-button";

import { SidebarCloseButton } from "@/components/headers/sidebar-close-button";
import {
  extraMutedIconColorMapping,
  iconButtonChromeGlyphSize,
  mutedIconColorMapping,
} from "@/components/ui/icon-button-chrome";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { WORKSPACE_SECONDARY_HEADER_HEIGHT } from "@/constants/layout";
import { useHasWindowChromeObstruction } from "@/utils/desktop-window";

import type { ShortcutKey } from "@/utils/format-shortcut";

const ThemedPanelRight = withUnistyles(PanelRight);
const ThemedChevronsLeft = withUnistyles(ChevronsLeft);
const ThemedChevronsRight = withUnistyles(ChevronsRight);

export const EXPLORER_TOGGLE_KEYS: ShortcutKey[] = ["mod", "E"];

interface WorkspaceExplorerToggleProps {
  onPress: () => void;
  label: string;
  tooltipLabel: string;
  tooltipKeys?: ShortcutKey[];
  accessibilityState: { expanded: boolean };
  mobile: boolean;
  style?: StyleProp<ViewStyle>;
}

// CUSTOM(explorer-toggle-tab-row): who renders the toggle: the compact overlay, the (now empty)
// header, or the window's titlebar.
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

export interface DesktopWorkspaceExplorerToggleProps extends Omit<
  WorkspaceExplorerToggleProps,
  "mobile"
> {
  owner: WorkspaceExplorerToggleOwner;
  tooltipKeys: ShortcutKey[];
}

function WorkspaceExplorerToggle({
  onPress,
  label,
  tooltipLabel,
  tooltipKeys = EXPLORER_TOGGLE_KEYS,
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

export function useWorkspaceExplorerControls({
  hasWorkspace,
  compact,
  focusMode,
  expanded,
  onToggle,
}: {
  hasWorkspace: boolean;
  compact: boolean;
  focusMode: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const hasLeadingWindowControls = useHasWindowChromeObstruction("top-left");
  const inDesktopTitlebar = hasLeadingWindowControls && hasWorkspace && !compact && !focusMode;

  return useMemo(() => {
    const props = {
      label: expanded
        ? t("workspace.tabs.explorerSidebar.close")
        : t("workspace.tabs.explorerSidebar.open"),
      tooltipLabel: t("workspace.tabs.explorerSidebar.toggle"),
      onPress: onToggle,
      accessibilityState: { expanded },
    };

    if (inDesktopTitlebar) {
      // Keep the button in the header Tab order. The active rail carves its slot out of the drag region.
      const headerSlot = expanded ? null : (
        <View
          pointerEvents="none"
          style={[headerIconSlotStyle.slot, styles.headerAction]}
          dataSet={WINDOW_NO_DRAG_DATASET}
        />
      );
      return {
        inDesktopTitlebar,
        headerAction: headerSlot,
        compactAction: headerSlot,
        dockAction: (
          <View
            pointerEvents="none"
            style={[headerIconSlotStyle.slot, styles.dockAction]}
            dataSet={WINDOW_NO_DRAG_DATASET}
          />
        ),
        titlebarAction: (
          <View pointerEvents="box-none" style={styles.titlebarSlot}>
            <WorkspaceExplorerToggle {...props} mobile={false} />
          </View>
        ),
      };
    }

    return {
      inDesktopTitlebar,
      headerAction: compact ? null : (
        <WorkspaceExplorerToggle {...props} mobile={false} style={styles.headerAction} />
      ),
      compactAction: <WorkspaceExplorerToggle {...props} mobile />,
      dockAction: compact ? (
        <SidebarCloseButton
          label={props.label}
          onPress={onToggle}
          testID="workspace-explorer-toggle"
          accessibilityState={props.accessibilityState}
        />
      ) : null,
      titlebarAction: null,
    };
  }, [compact, expanded, inDesktopTitlebar, onToggle, t]);
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
      expanded={Boolean(accessibilityState.expanded)}
      onPress={onPress}
    >
      <Icon size={21} uniProps={mutedIconColorMapping} />
    </ToolbarButton>
  );
}

const styles = StyleSheet.create((theme) => ({
  headerAction: {
    marginRight: { xs: 0, md: -theme.spacing[2] },
  },
  dockAction: {
    // The dock divider is absolutely positioned. Match the other headers' content center.
    marginBottom: theme.borderWidth[1],
  },
  titlebarSlot: {
    position: "absolute",
    top: 0,
    right: theme.spacing[1],
    height: WORKSPACE_SECONDARY_HEADER_HEIGHT,
    // Center with the bordered workspace header and Explorer tabs row.
    borderBottomWidth: theme.borderWidth[1],
    borderBottomColor: "transparent",
    justifyContent: "center",
    zIndex: 1,
  },
}));
