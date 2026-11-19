// CUSTOM(status-bar): the window's status bar and the host of its plugin items.
import type {
  PluginHostProps,
  PluginOpenScreenInput,
  PluginPopoverProps,
  PluginScreenLocation,
  PluginStatusBarItemProps,
} from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { router, useGlobalSearchParams, usePathname } from "expo-router";
import { useCallback, useMemo, useRef, useState, type ComponentType, type RefObject } from "react";
import { View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { SidebarPopoverRoot, useSidebarPopoverAnchor } from "@/components/sidebar/sidebar-popover";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import { useHostRuntimeClient, useHosts } from "@/runtime/host-runtime";
import { createPluginClientStateSource } from "../client-state/source";
import { pluginScreensHostKey, rememberPluginContributionHost } from "../contribution-host";
import { usePluginHostNavigation } from "../host-navigation";
import { withBeforeNavigate } from "../host-navigation-model";
import {
  PluginEnvironmentProvider,
  PluginPopoverContent,
  PluginPopoverSurface,
  type PluginEnvironment,
} from "../popover";
import { resolvePluginPlatform } from "../platform";
import { useInstalledPlugins } from "../registry";
import { buildPluginSurfaceRoute, hostIdFromPathname } from "../routes";
import { pluginThemeMapping, renderNothing } from "../sidebar-items";
import { currentPluginScreen, parsePluginOpenScreenInput } from "../surface-contribution";
import { SurfaceErrorBoundary } from "../surface-error-boundary";
import { StatusBarItemFrameContext, type StatusBarItemFrame } from "./frame";
import {
  layoutPluginStatusBar,
  selectPluginStatusBarTarget,
  type PluginStatusBarGroup,
  type PluginStatusBarTarget,
} from "./model";
import { openWorkboardInDesk } from "@/task-navigation/desk-workboard-store";

export { StatusBarItem } from "./kit";

type PopoverContent = ComponentType<PluginPopoverProps>;
type Placement = "bar" | "drawer";

interface PluginStatusBarProps {
  placement: Placement;
  /** Runs before a plugin item navigates, such as closing the compact sidebar. */
  onBeforeNavigate?: () => void;
}

/**
 * The status bar. "bar" is the wide layouts' strip at the bottom of the window; "drawer" is a
 * plain row of the same items for the compact sidebar's footer. Renders nothing without items.
 */
export function PluginStatusBar({ placement, onBeforeNavigate }: PluginStatusBarProps) {
  const plugins = useInstalledPlugins();
  const { left, right } = useMemo(() => layoutPluginStatusBar(plugins), [plugins]);
  if (left.length === 0 && right.length === 0) return null;
  const isBar = placement === "bar";
  return (
    <View
      style={isBar ? styles.bar : styles.drawer}
      testID={isBar ? "app-status-bar" : "sidebar-status-bar"}
    >
      {left.length > 0 ? (
        <View style={isBar ? styles.leftGroup : styles.drawerGroup}>
          {left.map((group) => (
            <ThemedStatusBarItem
              key={group.key}
              group={group}
              side="left"
              placement={placement}
              onBeforeNavigate={onBeforeNavigate}
              uniProps={pluginThemeMapping}
            />
          ))}
        </View>
      ) : null}
      {right.length > 0 ? (
        <View style={isBar ? styles.rightGroup : styles.drawerGroup}>
          {right.map((group) => (
            <ThemedStatusBarItem
              key={group.key}
              group={group}
              side="right"
              placement={placement}
              onBeforeNavigate={onBeforeNavigate}
              uniProps={pluginThemeMapping}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

interface StatusBarItemHostProps {
  group: PluginStatusBarGroup;
  side: "left" | "right";
  placement: Placement;
  onBeforeNavigate?: () => void;
}

/**
 * One plugin status bar item. Renders the item's `Component` from the host the model picks,
 * inside the plugin's runtime and its own error boundary: a throwing item renders nothing.
 */
function StatusBarItemHost({
  group,
  side,
  placement,
  onBeforeNavigate,
  theme,
}: StatusBarItemHostProps & { theme: PluginTheme }) {
  const pathname = usePathname();
  const routeParams = useGlobalSearchParams();
  const { plugin, item } = selectPluginStatusBarTarget(group, hostIdFromPathname(pathname));
  const client = useHostRuntimeClient(plugin.serverId);
  const toast = useToast();
  // The content outlives `open` so the surface can play its exit and native sheet teardown.
  const [popover, setPopover] = useState<PopoverContent | null>(null);
  const [popoverOpen, setPopoverOpen] = useState(false);
  const fallbackAnchorRef = useRef<View | null>(null);
  const environment = useMemo<PluginEnvironment | null>(
    () =>
      client
        ? {
            installation: plugin,
            toast,
            state: createPluginClientStateSource(plugin.serverId),
          }
        : null,
    [client, plugin, toast],
  );
  const showPopover = useCallback((content: PopoverContent | null) => {
    // A function passed to a state setter is an updater, so wrap the component.
    if (content) setPopover(() => content);
    setPopoverOpen(content !== null);
  }, []);
  const handleOpenChange = useCallback((open: boolean) => {
    if (!open) setPopoverOpen(false);
  }, []);
  if (!environment) return null;
  return (
    <SurfaceErrorBoundary
      installation={plugin}
      Surface={item.Component}
      renderError={renderNothing}
    >
      <PluginEnvironmentProvider environment={environment}>
        <SidebarPopoverRoot open={popoverOpen} onOpenChange={handleOpenChange}>
          <View ref={fallbackAnchorRef} collapsable={false} style={styles.item}>
            <StatusBarItemContent
              plugin={plugin}
              item={item}
              side={side}
              placement={placement}
              theme={theme}
              currentScreen={currentPluginScreen(plugin, pathname, routeParams)}
              environment={environment}
              popover={popover}
              showPopover={showPopover}
              fallbackAnchorRef={fallbackAnchorRef}
              onBeforeNavigate={onBeforeNavigate}
            />
          </View>
        </SidebarPopoverRoot>
      </PluginEnvironmentProvider>
    </SurfaceErrorBoundary>
  );
}

const ThemedStatusBarItem = withUnistyles(StatusBarItemHost);

function StatusBarItemContent({
  plugin,
  item,
  side,
  placement,
  theme,
  currentScreen,
  environment,
  popover,
  showPopover,
  fallbackAnchorRef,
  onBeforeNavigate,
}: {
  plugin: PluginStatusBarTarget["plugin"];
  item: PluginStatusBarTarget["item"];
  side: "left" | "right";
  placement: Placement;
  theme: PluginTheme;
  currentScreen: PluginScreenLocation | null;
  environment: PluginEnvironment;
  popover: PopoverContent | null;
  showPopover: (content: PopoverContent | null) => void;
  fallbackAnchorRef: RefObject<View | null>;
  onBeforeNavigate?: () => void;
}) {
  const { anchorTo, offerAnchor, releaseAnchor, anchorToFallback } =
    useSidebarPopoverAnchor("PluginStatusBarItem");
  const hosts = useHosts();
  const compact = useIsCompactFormFactor();
  const hostLabel =
    hosts.find((host) => host.serverId === plugin.serverId)?.label ?? plugin.serverId;
  const title = plugin.i18n.resolve(item.title, plugin.locale);

  const hostProps = useMemo<PluginHostProps>(
    () => ({
      theme,
      host: { id: plugin.serverId, label: hostLabel },
      layout: { compact, platform: resolvePluginPlatform() },
    }),
    [compact, hostLabel, plugin.serverId, theme],
  );
  const openScreen = useCallback(
    (input: PluginOpenScreenInput) => {
      const { screenId, params } = parsePluginOpenScreenInput(plugin, input);
      rememberPluginContributionHost(pluginScreensHostKey(plugin.id), plugin.serverId);
      showPopover(null);
      onBeforeNavigate?.();
      // CUSTOM(workboard-chip-only): in Tasks mode Power Workboard opens on its Desk chip.
      if (openWorkboardInDesk({ pluginId: plugin.id, screenId, params })) return;
      router.push(
        buildPluginSurfaceRoute(
          plugin.serverId,
          plugin.id,
          { kind: "surface", id: screenId },
          params,
        ),
      );
    },
    [onBeforeNavigate, plugin, showPopover],
  );
  const openPopover = useCallback(
    (Content: PopoverContent) => {
      anchorToFallback(fallbackAnchorRef);
      showPopover(Content);
    },
    [anchorToFallback, fallbackAnchorRef, showPopover],
  );
  const close = useCallback(() => showPopover(null), [showPopover]);
  // Navigating closes the popover and, in the drawer, the compact sidebar first.
  const hostNavigation = usePluginHostNavigation(plugin.serverId);
  const navigation = useMemo(
    () =>
      withBeforeNavigate(hostNavigation, () => {
        showPopover(null);
        onBeforeNavigate?.();
      }),
    [hostNavigation, onBeforeNavigate, showPopover],
  );
  const testID = `plugin-status-bar-${plugin.id}-${item.id}`;
  const frame = useMemo<StatusBarItemFrame>(
    () => ({ placement, title, testID, anchorTo, offerAnchor, releaseAnchor }),
    [anchorTo, offerAnchor, placement, releaseAnchor, testID, title],
  );
  const itemProps = useMemo<PluginStatusBarItemProps>(
    () => ({ ...hostProps, currentScreen, openScreen, openPopover, navigation, placement }),
    [currentScreen, hostProps, navigation, openPopover, openScreen, placement],
  );
  const Item = item.Component;
  const Popover = popover;
  return (
    <StatusBarItemFrameContext.Provider value={frame}>
      <Item {...itemProps} />
      {Popover ? (
        <PluginPopoverSurface
          sheetTitle={title}
          side="top"
          align={side === "right" ? "end" : "start"}
          offset={8}
          testID={`${testID}-popover`}
        >
          <SurfaceErrorBoundary installation={plugin} Surface={Popover}>
            <PluginEnvironmentProvider environment={environment}>
              <PluginPopoverContent>
                <Popover
                  {...hostProps}
                  close={close}
                  openScreen={openScreen}
                  navigation={navigation}
                />
              </PluginPopoverContent>
            </PluginEnvironmentProvider>
          </SurfaceErrorBoundary>
        </PluginPopoverSurface>
      ) : null}
    </StatusBarItemFrameContext.Provider>
  );
}

const styles = StyleSheet.create((theme) => ({
  bar: {
    height: 24,
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: theme.colors.surfaceSidebar,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  // About 20px from the left sidebar. It shrinks so a long label ellipsizes.
  leftGroup: {
    flexShrink: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingLeft: 20,
  },
  rightGroup: {
    flexShrink: 0,
    marginLeft: "auto",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingRight: theme.spacing[3],
  },
  drawer: {
    minHeight: 32,
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    paddingHorizontal: theme.spacing[2],
    gap: theme.spacing[2],
  },
  drawerGroup: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  item: {
    flexShrink: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
}));
