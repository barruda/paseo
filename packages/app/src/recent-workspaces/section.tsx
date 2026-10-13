import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import { Pressable, Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useRecentlyActiveWorkspaces } from "@/active-workspace-cycle/use-recently-active-workspaces";
import { DensityIcon } from "@/components/ui/density-icon";
import { Shortcut } from "@/components/ui/shortcut";
import { useIsCompactFormFactor } from "@/constants/layout";
import { isNative } from "@/constants/platform";
import type { SidebarWorkspacePlacement } from "@/hooks/use-sidebar-workspaces-list";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { useSidebarWorkspaceLimitStore } from "@/sidebar-workspace-limit/store";
import { density, densityFontSize } from "@/styles/density";
import { useRecentHighlightStore } from "./highlight";
import { RecentWorkspaceTrailingContext } from "./trailing";

/**
 * The workspaces Shift+Tab cycles through (activity in the last 45 minutes), under New workspace.
 * Rows are the list's own workspace rows, without Ctrl+1..9 numbers and with the project icon on
 * the right. Absent when nothing is recent or when "Show Recent" is off in display preferences.
 */
export function RecentWorkspacesSection({
  projectIconByProjectViewKey,
  renderRow,
}: {
  projectIconByProjectViewKey: ReadonlyMap<string, string | null>;
  renderRow: (workspace: SidebarWorkspacePlacement) => ReactNode;
}) {
  const showRecent = useSidebarWorkspaceLimitStore((state) => state.showRecent);
  if (!showRecent) return null;
  return (
    <RecentWorkspacesSectionBody
      projectIconByProjectViewKey={projectIconByProjectViewKey}
      renderRow={renderRow}
    />
  );
}

function RecentWorkspacesSectionBody({
  projectIconByProjectViewKey,
  renderRow,
}: {
  projectIconByProjectViewKey: ReadonlyMap<string, string | null>;
  renderRow: (workspace: SidebarWorkspacePlacement) => ReactNode;
}) {
  const workspaces = useRecentlyActiveWorkspaces();
  const [collapsed, setCollapsed] = useState(false);
  const toggle = useCallback(() => setCollapsed((value) => !value), []);
  useEffect(() => {
    useRecentHighlightStore.setState({ visibleWorkspaces: collapsed ? [] : workspaces });
    return () => useRecentHighlightStore.setState({ visibleWorkspaces: [] });
  }, [collapsed, workspaces]);
  if (workspaces.length === 0) return null;
  return (
    <View style={styles.section} testID="sidebar-recent-section">
      <RecentWorkspacesHeader collapsed={collapsed} onToggle={toggle} />
      {collapsed ? null : (
        <RecentWorkspaceTrailingContext.Provider value={projectIconByProjectViewKey}>
          {workspaces.map((workspace) => (
            <View key={workspace.workspaceKey}>{renderRow(workspace)}</View>
          ))}
        </RecentWorkspaceTrailingContext.Provider>
      )}
      <View style={styles.divider} testID="sidebar-recent-divider" />
    </View>
  );
}

function RecentWorkspacesHeader({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const isCompact = useIsCompactFormFactor();
  const shortcutKeys = useShortcutKeys("message-input.active-workspace-cycle");
  const accessibilityState = useMemo(() => ({ expanded: !collapsed }), [collapsed]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      onPress={onToggle}
      style={styles.header}
      testID="sidebar-recent-section-header"
    >
      {({ hovered }) => (
        <>
          <Text style={styles.title}>Recent</Text>
          {hovered || isNative || isCompact ? (
            <DensityIcon
              icon={collapsed ? ChevronRight : ChevronDown}
              size="xs"
              color="foregroundMuted"
            />
          ) : null}
          <View style={styles.spacer} />
          {shortcutKeys ? <Shortcut chord={shortcutKeys} /> : null}
        </>
      )}
    </Pressable>
  );
}

// Same header and spacing as the Pinned section; the shortcut lines up with New workspace's.
const styles = StyleSheet.create((theme) => ({
  section: {
    marginBottom: theme.spacing[1],
  },
  divider: {
    borderBottomWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
    borderStyle: "dashed",
    opacity: theme.opacity[50],
    marginHorizontal: theme.spacing[2],
    marginTop: theme.spacing[2],
    marginBottom: theme.spacing[1],
  },
  header: {
    minHeight: density.rowHeight,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    paddingVertical: theme.spacing[1],
    userSelect: "none",
  },
  spacer: {
    flex: 1,
  },
  title: {
    color: theme.colors.foregroundMuted,
    fontSize: densityFontSize(theme, "sm"),
    fontWeight: theme.fontWeight.normal,
  },
}));
