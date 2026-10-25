// CUSTOM(desk-workboard): the Power Workboard plugin as a fixed tab beside the Desks. Shown by
// default; closing it moves it into the + menu until it is reopened. The board is the plugin's own
// screen, rendered here instead of on its route so the Desk header stays.
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useEffect, useMemo, useRef, type ReactNode } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { z } from "zod";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import type { ComponentType } from "react";
import type { PluginTheme } from "@getpaseo/plugin";
import { ScreenHeader } from "@/components/headers/screen-header";
import { useIsCompactFormFactor } from "@/constants/layout";
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
import { createValidatedPersistStorage } from "@/storage/validated-persist-storage";
import type { Theme } from "@/styles/theme";

export const DESK_WORKBOARD_LABEL = "Power Workboard";
const PLUGIN_ID = "power-workboard";
const IDENTITY = { kind: "sidebar", id: "power-workboard" } as const;

interface DeskWorkboardState {
  /** The tab is in the header; false once closed, until reopened from +. */
  open: boolean;
  /** The board shows instead of the Desk's tabs. */
  selected: boolean;
  select(): void;
  deselect(): void;
  close(): void;
  reopen(): void;
}
export const useDeskWorkboardStore = create<DeskWorkboardState>()(
  persist(
    (set) => ({
      open: true,
      selected: false,
      select: () => set({ open: true, selected: true }),
      deselect: () => set((state) => (state.selected ? { selected: false } : state)),
      close: () => set({ open: false, selected: false }),
      reopen: () => set({ open: true, selected: true }),
    }),
    {
      name: "custom-desk-workboard",
      version: 1,
      storage: createValidatedPersistStorage(
        AsyncStorage,
        z.object({ open: z.boolean(), selected: z.boolean() }),
      ),
      partialize: (state) => ({ open: state.open, selected: state.selected }),
    },
  ),
);

/** The installation that shows the board: the local daemon's when it has the plugin. */
export function useDeskWorkboardInstallation(): InstalledPlugin | null {
  const installations = usePluginInstallations(PLUGIN_ID);
  const localServerId = useLocalDaemonServerId();
  return useMemo(() => {
    const usable = installations.filter(
      (plugin) => resolvePluginSurfaceContribution(plugin, IDENTITY).surface !== null,
    );
    return usable.find((plugin) => plugin.serverId === localServerId) ?? usable[0] ?? null;
  }, [installations, localServerId]);
}

/**
 * Whether the board's tab is in the header and showing. Opening a tab or switching Desks while
 * the board shows returns to the Desk.
 */
export function useDeskWorkboard(
  deskId: string,
  activeTab: { id: string } | null,
): { plugin: InstalledPlugin | null; open: boolean; selected: boolean } {
  const plugin = useDeskWorkboardInstallation();
  const open = useDeskWorkboardStore((s) => s.open) && plugin !== null;
  const selected = useDeskWorkboardStore((s) => s.selected) && open;
  const activeTabId = activeTab?.id ?? null;
  const previous = useRef({ deskId, activeTabId });
  useEffect(() => {
    const before = previous.current;
    previous.current = { deskId, activeTabId };
    if (before.deskId !== deskId || before.activeTabId !== activeTabId) {
      useDeskWorkboardStore.getState().deselect();
    }
  }, [deskId, activeTabId]);
  return { plugin, open, selected };
}

/** With a plugin, the Desk header and the board replace `children`, which stay mounted but hidden. */
export function DeskWorkboardCover({
  plugin,
  headerLeft,
  children,
}: {
  plugin: InstalledPlugin | null;
  headerLeft: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      {plugin ? (
        <>
          <ScreenHeader left={headerLeft} />
          <DeskWorkboardView plugin={plugin} />
        </>
      ) : null}
      <View style={plugin ? styles.hidden : styles.body}>{children}</View>
    </>
  );
}

const pluginThemeMapping = (theme: Theme) => ({ theme: toPluginTheme(theme) });

function Board({
  Surface,
  plugin,
  theme,
}: {
  Surface: ComponentType<PluginScreenProps>;
  plugin: InstalledPlugin;
  theme: PluginTheme;
}) {
  const compact = useIsCompactFormFactor();
  const hosts = useHosts();
  const navigation = usePluginHostNavigation(plugin.serverId);
  const label = hosts.find((host) => host.serverId === plugin.serverId)?.label ?? plugin.serverId;
  const host = useMemo(() => ({ id: plugin.serverId, label }), [label, plugin.serverId]);
  const layout = useMemo(() => ({ compact, platform: resolvePluginPlatform() }), [compact]);
  const params = useMemo(() => ({}), []);
  return (
    <PluginInstallationProvider plugin={plugin}>
      <Surface theme={theme} host={host} layout={layout} navigation={navigation} params={params} />
    </PluginInstallationProvider>
  );
}
const ThemedBoard = withUnistyles(Board);

export function DeskWorkboardView({ plugin }: { plugin: InstalledPlugin }) {
  const client = useHostRuntimeClient(plugin.serverId);
  const { surface } = resolvePluginSurfaceContribution(plugin, IDENTITY);
  return (
    <View style={styles.body} testID="desk-workboard">
      {surface && client ? (
        <SurfaceErrorBoundary
          key={plugin.serverId}
          installation={plugin}
          Surface={surface.Component}
        >
          <ThemedBoard Surface={surface.Component} plugin={plugin} uniProps={pluginThemeMapping} />
        </SurfaceErrorBoundary>
      ) : (
        <Text style={styles.error}>
          {surface ? "Plugin host is offline." : "Power Workboard is unavailable."}
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
