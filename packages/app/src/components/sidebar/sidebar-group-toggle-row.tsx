import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type PressableStateCallbackType } from "react-native";
import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react-native";
import { StyleSheet } from "react-native-unistyles";
import { isWeb } from "@/constants/platform";
import { sidebarWorkspaceRowStyles } from "@/components/sidebar/sidebar-workspace-row-content";
import { DensityIcon } from "@/components/ui/density-icon";
import { density, densityFontSize, densityIconBox } from "@/styles/density";

/**
 * The row that ends a truncated group. It is a workspace row that happens to say "Show more", so
 * it takes the workspace row's geometry — height, padding, radius, and both fills — rather than a
 * set of its own. Sitting under a column of rows, anything it does differently reads as a mistake
 * rather than as a distinction.
 *
 * `indented` because the two groupings disagree: status rows sit on their header's label rail and
 * project rows sit flush, so the caller says which list this row is ending. The indent itself is
 * the workspace row's, imported rather than re-derived.
 */
export function SidebarGroupToggleRow({
  expanded,
  onPress,
  indented = false,
  hiddenCount,
  label: labelOverride,
  testID,
}: {
  expanded: boolean;
  onPress: () => void;
  indented?: boolean;
  /** CUSTOM(sidebar-workspace-limit): set, the collapsed row reads "> Show N more". */
  hiddenCount?: number;
  /** CUSTOM(task-idle-limit): a step the count does not describe, such as "Show next 5". */
  label?: string;
  testID: string;
}) {
  const { t } = useTranslation();
  let label = t(
    expanded ? "sidebar.workspace.actions.showLess" : "sidebar.workspace.actions.showMore",
  );
  if (!expanded && hiddenCount !== undefined) label = `Show ${hiddenCount} more`;
  if (labelOverride !== undefined) label = labelOverride;
  const collapsedIcon = hiddenCount === undefined ? ChevronDown : ChevronRight;
  const rowStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      indented && sidebarWorkspaceRowStyles.rowIndented,
      hovered && !pressed && styles.rowHovered,
      pressed && styles.rowPressed,
    ],
    [indented],
  );

  return (
    <Pressable
      accessibilityRole={isWeb ? undefined : "button"}
      accessibilityLabel={label}
      onPress={onPress}
      style={rowStyle}
      testID={testID}
    >
      {({ hovered, pressed }) => (
        <>
          <View style={[styles.iconSlot, hiddenCount !== undefined && styles.quietIcon]}>
            <DensityIcon
              icon={expanded ? ChevronUp : collapsedIcon}
              size="sm"
              color={hovered || pressed ? "foreground" : "foregroundMuted"}
            />
          </View>
          <Text
            style={[
              hovered || pressed ? styles.textHovered : styles.text,
              hiddenCount !== undefined && styles.quietText,
            ]}
            numberOfLines={1}
          >
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Kept in step with `workspaceRow` in sidebar-workspace-list.tsx and sidebar-status-list.tsx.
  row: {
    minHeight: density.rowHeight,
    marginBottom: theme.spacing[0.5],
    paddingVertical: theme.spacing[2],
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    userSelect: "none",
  },
  rowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  // The width of a workspace row's status slot, so the label lands on the same rail as the
  // titles above it rather than two points to their left.
  iconSlot: {
    width: densityIconBox("md"),
    height: densityIconBox("md"),
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  // CUSTOM(sidebar-workspace-limit): de-emphasize expansion controls when scanning workspace names.
  quietIcon: {
    transform: [{ scale: 0.5 }],
    opacity: 0.5,
  },
  quietText: {
    fontSize: {
      xs: densityFontSize(theme, "base").xs * 0.5,
      md: densityFontSize(theme, "base").md * 0.5,
    },
    opacity: 0.5,
  },
  text: {
    color: theme.colors.foregroundMuted,
    fontSize: densityFontSize(theme, "base"),
    minWidth: 0,
    flexShrink: 1,
  },
  textHovered: {
    color: theme.colors.foreground,
    fontSize: densityFontSize(theme, "base"),
    minWidth: 0,
    flexShrink: 1,
  },
}));
