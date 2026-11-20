// CUSTOM(desk-workboard): the Power Workboard plugin's surfaces as fixed tabs beside the Desks. Shown
// by default; closing one moves it into the + menu until it is reopened. Each is the plugin's own
// screen, rendered here instead of on its route so the Desk header stays.
// CUSTOM(workboard-inner-pages): only Power Workboard is a chip; the Projects Assistant pages are
// tabs inside it. Its inner tab (kept in desk-workboard-store.ts) comes back as `params.tab`.
// CUSTOM(workboard-chip-only): in Tasks mode, opening Power Workboard from anywhere selects the chip.
// CUSTOM(workboard-chip-status): the chip's status icon, from the plugin's `workboard.desk-status`.
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Text, View } from "react-native";
import { Workflow } from "lucide-react-native";
import { useIsFocused } from "expo-router/react-navigation";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import type { ComponentType } from "react";
import type { PluginTheme } from "@getpaseo/plugin";
import { ScreenHeader } from "@/components/headers/screen-header";
import { StatusIcon } from "@/components/status-icon";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useFetchQuery } from "@/data/query";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { usePluginHostNavigation } from "@/plugins/host-navigation";
import { PluginInstallationProvider } from "@/plugins/installation-provider";
import { resolvePluginPlatform } from "@/plugins/platform";
import { usePluginInstallations } from "@/plugins/registry";
import type { InstalledPlugin } from "@/plugins/types";
import { resolvePluginSurfaceContribution } from "@/plugins/surface-contribution";
import { SurfaceErrorBoundary } from "@/plugins/surface-error-boundary";
import { toPluginTheme } from "@/plugins/theme";
import { useHostRuntimeClient, useHosts } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";
import {
  DESK_STATUS_RPC_NAME,
  DESK_SURFACES,
  POWER_WORKBOARD_PLUGIN_ID,
  deskStatusPollMs,
  deskStatusSchema,
  deskWorkboardStatusMark,
  isDeskSurfaceOpen,
  type DeskSurfaceDefinition,
} from "./desk-workboard-model";
import { useDeskWorkboardStore } from "./desk-workboard-store";

export {
  openWorkboardInDesk,
  openWorkboardPanelInDesk,
  useDeskWorkboardStore,
} from "./desk-workboard-store";

export const DESK_WORKBOARD_LABEL = DESK_SURFACES[0].label;

export interface DeskSurfaceEntry {
  definition: DeskSurfaceDefinition;
  /** The installation that shows it: the local daemon's when it has the surface. */
  plugin: InstalledPlugin;
  open: boolean;
}

/** Surfaces that exist on some installation, in `DESK_SURFACES` order. */
export function useDeskSurfaceEntries(): DeskSurfaceEntry[] {
  const installations = usePluginInstallations(POWER_WORKBOARD_PLUGIN_ID);
  const localServerId = useLocalDaemonServerId();
  const open = useDeskWorkboardStore((s) => s.open);
  return useMemo(() => {
    const entries: DeskSurfaceEntry[] = [];
    for (const definition of DESK_SURFACES) {
      const usable = installations.filter(
        (plugin) => resolvePluginSurfaceContribution(plugin, definition.identity).surface !== null,
      );
      const plugin = usable.find((p) => p.serverId === localServerId) ?? usable[0] ?? null;
      if (plugin)
        entries.push({
          definition,
          plugin,
          open: isDeskSurfaceOpen(open, definition.id),
        });
    }
    return entries;
  }, [installations, localServerId, open]);
}

/**
 * The surface tabs and which one shows. Opening a tab or switching Desks while a surface shows
 * returns to the Desk.
 */
export function useDeskWorkboard(
  deskId: string,
  activeTab: { id: string } | null,
): { entries: DeskSurfaceEntry[]; selected: DeskSurfaceEntry | null } {
  const entries = useDeskSurfaceEntries();
  const selectedId = useDeskWorkboardStore((s) => s.selected);
  const selected = useMemo(
    () => entries.find((entry) => entry.open && entry.definition.id === selectedId) ?? null,
    [entries, selectedId],
  );
  const activeTabId = activeTab?.id ?? null;
  const revision = useDeskWorkboardStore((s) => s.revision);
  const previous = useRef({ deskId, activeTabId, revision });
  useEffect(() => {
    const before = previous.current;
    previous.current = { deskId, activeTabId, revision };
    if (before.revision !== revision) return; // CUSTOM(workboard-chip-only)
    if (before.deskId !== deskId || before.activeTabId !== activeTabId) {
      useDeskWorkboardStore.getState().deselect();
    }
  }, [deskId, activeTabId, revision]);
  return { entries, selected };
}

/**
 * CUSTOM(workboard-chip-status): the plugin icon with the agent-tab status overlay. A plugin
 * without `workboard.desk-status` (not reloaded yet) leaves the chip clean. Asks only while the
 * Desk is the focused screen and the app is visible, and backs off after a failure.
 */
export function DeskWorkboardChipIcon({
  plugin,
  active,
}: {
  plugin: InstalledPlugin;
  active: boolean;
}) {
  const isFocused = useIsFocused();
  const isAppVisible = useAppVisible();
  const { data } = useFetchQuery({
    queryKey: ["desk-workboard-status", plugin.serverId, plugin.id],
    queryFn: async () => deskStatusSchema.parse(await plugin.invoke(DESK_STATUS_RPC_NAME, {})),
    dataShape: "value",
    staleTimeMs: 0,
    enabled: isFocused && isAppVisible,
    refetchInterval: (query) => deskStatusPollMs(query.state.status === "error"),
    retry: false,
  });
  const mark = deskWorkboardStatusMark(data);
  return (
    <StatusIcon statusBucket={mark.bucket} showRunning={mark.running} size={14} backdrop="surface0">
      <ThemedWorkflow size={14} uniProps={active ? activeIconMapping : mutedIconMapping} />
    </StatusIcon>
  );
}
const ThemedWorkflow = withUnistyles(Workflow);
const activeIconMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const mutedIconMapping = (theme: Theme) => ({ color: theme.colors.foregroundExtraMuted });

/** With a plugin, the Desk header and the board replace `children`, which stay mounted but hidden. */
export function DeskWorkboardCover({
  surface,
  headerLeft,
  children,
}: {
  surface: DeskSurfaceEntry | null;
  headerLeft: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      {surface ? (
        <>
          <ScreenHeader left={headerLeft} />
          <DeskWorkboardView plugin={surface.plugin} definition={surface.definition} />
        </>
      ) : null}
      <View style={surface ? styles.hidden : styles.body}>{children}</View>
    </>
  );
}

const pluginThemeMapping = (theme: Theme) => ({ theme: toPluginTheme(theme) });

function Board({
  Surface,
  plugin,
  surfaceId,
  theme,
}: {
  Surface: ComponentType<PluginScreenProps>;
  plugin: InstalledPlugin;
  surfaceId: string;
  theme: PluginTheme;
}) {
  const compact = useIsCompactFormFactor();
  const hosts = useHosts();
  const hostNavigation = usePluginHostNavigation(plugin.serverId);
  // CUSTOM(projects-assistant): surfaces switch between the Desk's plugin tabs with this; the
  // plugin reads it with a cast, it is not part of the published navigation type.
  const navigation = useMemo(
    () => ({
      ...hostNavigation,
      // CUSTOM(projects-assistant): opening an agent returns to the Desk even when that agent's
      // tab is already the active one (then the tab-change deselect would not fire).
      openAgent: (input: Parameters<typeof hostNavigation.openAgent>[0]) => {
        hostNavigation.openAgent(input);
        useDeskWorkboardStore.getState().deselect();
      },
      openDeskSurface: (id: string) => useDeskWorkboardStore.getState().openSurface(id),
      // CUSTOM(workboard-inner-pages): the board reports its inner tab, so it comes back on it.
      setDeskWorkboardTab: (tab: string) => useDeskWorkboardStore.getState().setTab(tab),
    }),
    [hostNavigation],
  );
  const tab = useDeskWorkboardStore((s) => s.tab);
  const tabRequest = useDeskWorkboardStore((s) => s.tabRequest); // CUSTOM(workboard-chip-only)
  const label = hosts.find((host) => host.serverId === plugin.serverId)?.label ?? plugin.serverId;
  const host = useMemo(() => ({ id: plugin.serverId, label }), [label, plugin.serverId]);
  const layout = useMemo(() => ({ compact, platform: resolvePluginPlatform() }), [compact]);
  const params = useMemo((): Record<string, string> => {
    if (!tab) return {};
    return tabRequest ? { tab, request: tabRequest } : { tab };
  }, [tab, tabRequest]);
  return (
    <PluginInstallationProvider plugin={plugin}>
      <Surface
        key={surfaceId}
        theme={theme}
        host={host}
        layout={layout}
        navigation={navigation}
        params={params}
      />
    </PluginInstallationProvider>
  );
}
const ThemedBoard = withUnistyles(Board);

export function DeskWorkboardView({
  plugin,
  definition,
}: {
  plugin: InstalledPlugin;
  definition: DeskSurfaceDefinition;
}) {
  const client = useHostRuntimeClient(plugin.serverId);
  const { surface } = resolvePluginSurfaceContribution(plugin, definition.identity);
  return (
    <View style={styles.body} testID="desk-workboard">
      {surface && client ? (
        <SurfaceErrorBoundary
          key={`${plugin.serverId}:${definition.id}`}
          installation={plugin}
          Surface={surface.Component}
        >
          <ThemedBoard
            Surface={surface.Component}
            plugin={plugin}
            surfaceId={definition.id}
            uniProps={pluginThemeMapping}
          />
        </SurfaceErrorBoundary>
      ) : (
        <Text style={styles.error}>
          {surface ? "Plugin host is offline." : `${definition.label} is unavailable.`}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: { flex: 1, minHeight: 0 },
  hidden: { display: "none" },
  error: { color: theme.colors.statusDanger, padding: theme.spacing[4] },
}));
