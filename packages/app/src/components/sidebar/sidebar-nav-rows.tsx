import { router, usePathname } from "expo-router";
import { CalendarClock, History, Plus, Search } from "lucide-react-native";
import { memo, useCallback, useMemo, useRef, type ComponentType } from "react";
import { useTranslation } from "react-i18next";
import { View, type StyleProp, type ViewStyle } from "react-native";
import { SidebarVoiceRow } from "@/voice/sidebar/row";
import { SidebarHeaderRow } from "@/components/sidebar/sidebar-header-row";
// CUSTOM(sidebar-new-workspace-in-list)
import { Shortcut } from "@/components/ui/shortcut";
import { useShortcutKeys } from "@/hooks/use-shortcut-keys";
import { PluginSidebarItem } from "@/plugins/sidebar-items";
import { canCreateWorktreeForProjectKind } from "@/projects/host-projects";
import { useHostFeature } from "@/runtime/host-features";
import {
  builtinSidebarNavLabelKey,
  builtinSidebarNavShortcutAction,
  type BuiltinSidebarNavId,
} from "@/sidebar-nav/model";
import { useSidebarNavItems } from "@/sidebar-nav/use-sidebar-nav-items";
import { useKeyboardShortcutsStore } from "@/stores/keyboard-shortcuts-store";
import { useActiveWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import { useWorkspace } from "@/stores/session-store-hooks";
import {
  buildNewWorkspaceRoute,
  buildSchedulesRoute,
  buildSessionsRoute,
} from "@/utils/host-routes";

interface SidebarNavRowProps {
  onBeforeNavigate?: () => void;
}

interface SidebarNavRowsProps extends SidebarNavRowProps {
  /** Style for the group wrapper, which the sidebar owns. */
  style?: StyleProp<ViewStyle>;
}

/**
 * Top-level sidebar navigation, ordered and filtered by the user's
 * `sidebarNavItems` preference. The independent Voice session stays below these items.
 */
export function SidebarNavRows({ style, onBeforeNavigate }: SidebarNavRowsProps) {
  const { items } = useSidebarNavItems("header");
  // CUSTOM(sidebar-new-workspace-in-list): New workspace renders in the Workspaces area instead,
  // through SidebarWorkspacesNewWorkspaceRow.
  const visibleItems = useMemo(
    () =>
      items.filter(
        (item) => item.visible && !(item.kind === "builtin" && item.id === "new-workspace"),
      ),
    [items],
  );
  const groupRef = useRef<View | null>(null);

  return (
    <View ref={groupRef} collapsable={false} style={style}>
      {visibleItems.map((item) => {
        if (item.kind === "plugin") {
          return (
            <PluginSidebarItem
              key={item.key}
              group={item.group}
              section="header"
              fallbackAnchorRef={groupRef}
              onBeforeNavigate={onBeforeNavigate}
            />
          );
        }
        const Row = BUILTIN_ROWS[item.id];
        return <Row key={item.key} onBeforeNavigate={onBeforeNavigate} />;
      })}
      {/* CUSTOM(sidebar-voice): below Accounts/plugin navigation, above Workspaces. */}
      <SidebarVoiceRow />
    </View>
  );
}

/**
 * CUSTOM(sidebar-new-workspace-in-list): the New workspace row, placed under the Workspaces title.
 * Hiding it in Settings → Sidebar still hides it here.
 */
export function SidebarWorkspacesNewWorkspaceRow({ onBeforeNavigate }: SidebarNavRowProps) {
  const { items } = useSidebarNavItems("header");
  const visible = items.some(
    (item) => item.kind === "builtin" && item.id === "new-workspace" && item.visible,
  );
  if (!visible) return null;
  return <SidebarNewWorkspaceRow onBeforeNavigate={onBeforeNavigate} variant="inline" />;
}

const SidebarNewWorkspaceRow = memo(function SidebarNewWorkspaceRow({
  onBeforeNavigate,
  variant = "compact",
}: SidebarNavRowProps & { variant?: "compact" | "inline" }) {
  const { t } = useTranslation();
  const shortcutKeys = useShortcutKeys(builtinSidebarNavShortcutAction("new-workspace"));
  const activeWorkspaceSelection = useActiveWorkspaceSelection();
  const activeWorkspaceServerId = activeWorkspaceSelection?.serverId ?? null;
  const activeWorkspaceId = activeWorkspaceSelection?.workspaceId ?? null;
  const activeWorkspace = useWorkspace(activeWorkspaceServerId, activeWorkspaceId);
  const supportsWorkspaceMultiplicity = useHostFeature(
    activeWorkspaceServerId,
    "workspaceMultiplicity",
  );
  const canUseActiveWorkspaceContext = Boolean(
    activeWorkspace &&
    (supportsWorkspaceMultiplicity || canCreateWorktreeForProjectKind(activeWorkspace.projectKind)),
  );

  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    router.push(
      activeWorkspaceServerId
        ? buildNewWorkspaceRoute(
            activeWorkspace && canUseActiveWorkspaceContext
              ? {
                  serverId: activeWorkspaceServerId,
                  sourceDirectory: activeWorkspace.projectRootPath,
                  projectId: activeWorkspace.projectId,
                }
              : { serverId: activeWorkspaceServerId },
          )
        : buildNewWorkspaceRoute(),
    );
  }, [activeWorkspace, activeWorkspaceServerId, canUseActiveWorkspaceContext, onBeforeNavigate]);

  // CUSTOM(sidebar-new-workspace-in-list): the shortcut shows all the time, not only on hover.
  const shortcutBadge = useMemo(
    () => (shortcutKeys ? <Shortcut chord={shortcutKeys} /> : undefined),
    [shortcutKeys],
  );

  return (
    <SidebarHeaderRow
      icon={Plus}
      label={t(builtinSidebarNavLabelKey("new-workspace"))}
      onPress={handlePress}
      testID="sidebar-global-new-workspace"
      variant={variant}
      trailing={shortcutBadge}
    />
  );
});

function SidebarHistoryRow({ onBeforeNavigate }: SidebarNavRowProps) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    router.push(buildSessionsRoute());
  }, [onBeforeNavigate]);

  return (
    <SidebarHeaderRow
      icon={History}
      label={t(builtinSidebarNavLabelKey("history"))}
      onPress={handlePress}
      isActive={pathname.includes("/sessions")}
      testID="sidebar-sessions"
      variant="compact"
    />
  );
}

function SidebarSearchRow({ onBeforeNavigate }: SidebarNavRowProps) {
  const { t } = useTranslation();
  const shortcutKeys = useShortcutKeys(builtinSidebarNavShortcutAction("search"));
  const setCommandCenterOpen = useKeyboardShortcutsStore((state) => state.setCommandCenterOpen);
  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    setCommandCenterOpen(true);
  }, [onBeforeNavigate, setCommandCenterOpen]);

  return (
    <SidebarHeaderRow
      icon={Search}
      label={t(builtinSidebarNavLabelKey("search"))}
      onPress={handlePress}
      testID="sidebar-search"
      variant="compact"
      shortcutKeys={shortcutKeys}
    />
  );
}

function SidebarSchedulesRow({ onBeforeNavigate }: SidebarNavRowProps) {
  const { t } = useTranslation();
  const pathname = usePathname();
  const handlePress = useCallback(() => {
    onBeforeNavigate?.();
    router.push(buildSchedulesRoute());
  }, [onBeforeNavigate]);

  return (
    <SidebarHeaderRow
      icon={CalendarClock}
      label={t(builtinSidebarNavLabelKey("schedules"))}
      onPress={handlePress}
      isActive={pathname.includes("/schedules")}
      testID="sidebar-schedules"
      variant="compact"
    />
  );
}

const BUILTIN_ROWS: Record<BuiltinSidebarNavId, ComponentType<SidebarNavRowProps>> = {
  "new-workspace": SidebarNewWorkspaceRow,
  history: SidebarHistoryRow,
  search: SidebarSearchRow,
  schedules: SidebarSchedulesRow,
};
