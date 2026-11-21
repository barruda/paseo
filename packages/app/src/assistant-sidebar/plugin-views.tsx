// CUSTOM(pm-sidebar-decisions): the plugin views the right sidebar's Project Manager tab can swap
// in for its chat (`client.addAssistantSidebarView`), such as Power Workboard's open decisions.
// Each view and its header badge render inside the plugin's runtime and their own error boundary,
// like the status bar items: a throwing view or badge renders nothing.
import type { PluginAssistantSidebarViewProps, PluginHostProps } from "@getpaseo/plugin/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { useMemo, type ReactNode } from "react";
import { withUnistyles } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useToast } from "@/contexts/toast-context";
import { useHosts } from "@/runtime/host-runtime";
import { createPluginClientStateSource } from "@/plugins/client-state/source";
import { resolvePluginPlatform } from "@/plugins/platform";
import { PluginEnvironmentProvider, type PluginEnvironment } from "@/plugins/popover";
import { useInstalledPlugins } from "@/plugins/registry";
import { pluginThemeMapping, renderNothing } from "@/plugins/sidebar-items";
import { SurfaceErrorBoundary } from "@/plugins/surface-error-boundary";
import type { InstalledPlugin, PluginAssistantSidebarViewContribution } from "@/plugins/types";

export interface AssistantSidebarView {
  /** `pluginId/viewId`, unique on one host. */
  key: string;
  plugin: InstalledPlugin;
  view: PluginAssistantSidebarViewContribution;
  title: string;
}

/** The views of the plugins installed on the chat's host, in plugin then registration order. */
export function selectAssistantSidebarViews(
  plugins: readonly InstalledPlugin[],
  serverId: string | null,
): AssistantSidebarView[] {
  if (!serverId) return [];
  return plugins
    .filter((plugin) => plugin.serverId === serverId)
    .flatMap((plugin) =>
      (plugin.assistantSidebarViews ?? []).map((view) => ({
        key: `${plugin.id}/${view.id}`,
        plugin,
        view,
        title: plugin.i18n.resolve(view.title, plugin.locale),
      })),
    );
}

export function useAssistantSidebarViews(serverId: string | null): AssistantSidebarView[] {
  const plugins = useInstalledPlugins();
  return useMemo(() => selectAssistantSidebarViews(plugins, serverId), [plugins, serverId]);
}

function usePluginHostProps(plugin: InstalledPlugin, theme: PluginTheme): PluginHostProps {
  const hosts = useHosts();
  const compact = useIsCompactFormFactor();
  const hostLabel =
    hosts.find((host) => host.serverId === plugin.serverId)?.label ?? plugin.serverId;
  return useMemo(
    () => ({
      theme,
      host: { id: plugin.serverId, label: hostLabel },
      layout: { compact, platform: resolvePluginPlatform() },
    }),
    [compact, hostLabel, plugin.serverId, theme],
  );
}

function PluginRuntime({
  plugin,
  Surface,
  children,
}: {
  plugin: InstalledPlugin;
  Surface: unknown;
  children: ReactNode;
}) {
  const toast = useToast();
  const environment = useMemo<PluginEnvironment>(
    () => ({
      installation: plugin,
      toast,
      state: createPluginClientStateSource(plugin.serverId),
    }),
    [plugin, toast],
  );
  return (
    <SurfaceErrorBoundary installation={plugin} Surface={Surface} renderError={renderNothing}>
      <PluginEnvironmentProvider environment={environment}>{children}</PluginEnvironmentProvider>
    </SurfaceErrorBoundary>
  );
}

function ViewBadge({ entry, theme }: { entry: AssistantSidebarView; theme: PluginTheme }) {
  const hostProps = usePluginHostProps(entry.plugin, theme);
  const Badge = entry.view.Badge;
  if (!Badge) return null;
  return (
    <PluginRuntime plugin={entry.plugin} Surface={Badge}>
      <Badge {...hostProps} />
    </PluginRuntime>
  );
}

function ViewBody({
  entry,
  onClose,
  theme,
}: {
  entry: AssistantSidebarView;
  onClose: () => void;
  theme: PluginTheme;
}) {
  const hostProps = usePluginHostProps(entry.plugin, theme);
  const props = useMemo<PluginAssistantSidebarViewProps>(
    () => ({ ...hostProps, close: onClose }),
    [hostProps, onClose],
  );
  const Body = entry.view.Component;
  return (
    <PluginRuntime plugin={entry.plugin} Surface={Body}>
      <Body {...props} />
    </PluginRuntime>
  );
}

const ThemedViewBadge = withUnistyles(ViewBadge);
const ThemedViewBody = withUnistyles(ViewBody);

/** The view's badge (a count, say), drawn after its title in the header button. */
export function AssistantSidebarViewBadge({ entry }: { entry: AssistantSidebarView }) {
  return <ThemedViewBadge entry={entry} uniProps={pluginThemeMapping} />;
}

/** The view itself, in place of the chat. */
export function AssistantSidebarViewBody({
  entry,
  onClose,
}: {
  entry: AssistantSidebarView;
  onClose: () => void;
}) {
  return <ThemedViewBody entry={entry} onClose={onClose} uniProps={pluginThemeMapping} />;
}
