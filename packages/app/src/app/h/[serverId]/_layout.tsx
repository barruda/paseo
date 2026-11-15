import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useHostRuntimeBootstrapState } from "@/app/_layout";
import { HostRouteProvider } from "@/navigation/host-route-context";
import { resolveStartupRoute } from "@/navigation/host-runtime-bootstrap";
import { ThemedStack } from "@/navigation/themed-stack";
import { useHostRegistryStatus, useHosts } from "@/runtime/host-runtime";
import { useTranslation } from "react-i18next";
import { resolveEmbedHostRoute, useEmbedHostBootSettled } from "@/embed/embed-host-route";
import { isEmbedMode } from "@/embed/embed-mode";
import { EmbedStatusView } from "@/embed/embed-status-view";

const HOST_STACK_SCREEN_OPTIONS = {
  headerShown: false,
  animation: "none" as const,
};

const SCREEN_OWNED_APPEARANCE = ["workspace/[workspaceId]/index"] as const;

const AGENT_SCREEN_OPTIONS = { gestureEnabled: false };

export default function HostRouteLayout() {
  return <KnownHostRoute />;
}

function KnownHostRoute() {
  // CUSTOM(agent-embed): the embed flag is fixed for the page lifetime.
  return isEmbedMode() ? <EmbedKnownHostRoute /> : <RegularKnownHostRoute />;
}

function EmbedKnownHostRoute() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ serverId?: string | string[] }>();
  const hosts = useHosts();
  const hostRegistryStatus = useHostRegistryStatus();
  const bootstrapState = useHostRuntimeBootstrapState();
  const bootSettled = useEmbedHostBootSettled();
  const routeServerId = typeof params.serverId === "string" ? params.serverId : null;
  const decision = resolveEmbedHostRoute({
    hostKnown: routeServerId !== null && hosts.some((host) => host.serverId === routeServerId),
    hostRegistryLoading: hostRegistryStatus === "loading",
    startupBlocked: bootstrapState.startupBlocker.kind !== "none",
    bootSettled,
  });
  if (decision === "loading") {
    return <EmbedStatusView loading message={t("embed.connecting")} testID="embed-host-loading" />;
  }
  if (decision === "unavailable" || !routeServerId) {
    return <EmbedStatusView message={t("embed.hostNotServing")} testID="embed-host-unavailable" />;
  }
  return <HostStack routeServerId={routeServerId} />;
}

function RegularKnownHostRoute() {
  const params = useLocalSearchParams<{ serverId?: string | string[] }>();
  const hosts = useHosts();
  const hostRegistryStatus = useHostRegistryStatus();
  const bootstrapState = useHostRuntimeBootstrapState();
  const routeServerId = typeof params.serverId === "string" ? params.serverId : null;
  const startupRoute = resolveStartupRoute({
    route: { kind: "host", serverId: routeServerId },
    startupBlocker: bootstrapState.startupBlocker,
    hostRegistryStatus,
    hosts,
  });

  if (startupRoute.kind === "redirect") {
    return <Redirect href={startupRoute.href} />;
  }

  return <HostStack routeServerId={routeServerId} />;
}

function HostStack({ routeServerId }: { routeServerId: string | null }) {
  const stack = (
    <ThemedStack
      screenOptions={HOST_STACK_SCREEN_OPTIONS}
      screenOwnedAppearance={SCREEN_OWNED_APPEARANCE}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="workspace/[workspaceId]/index" />
      <Stack.Screen name="agent/[agentId]" options={AGENT_SCREEN_OPTIONS} />
      <Stack.Screen name="sessions" />
      <Stack.Screen name="open-project" />
      <Stack.Screen name="settings" />
      <Stack.Screen name="plugin/[pluginId]/[surfaceId]" />
      <Stack.Screen name="plugin/[pluginId]/[contributionKind]/[contributionId]" />
    </ThemedStack>
  );

  if (!routeServerId) {
    return stack;
  }

  return <HostRouteProvider serverId={routeServerId}>{stack}</HostRouteProvider>;
}
