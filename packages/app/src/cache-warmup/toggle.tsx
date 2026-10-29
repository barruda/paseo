import { useCallback, useEffect, useState } from "react";
import { Text } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Flame } from "lucide-react-native";
import { AgentControlTrigger } from "@/composer/agent-controls/control";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSessionStore } from "@/stores/session-store";
import type { AgentControlIconProps } from "@/agent-controls/icons";
import {
  CACHE_WARMUP_PROVIDER,
  cacheLastUsedAt,
  cacheWarmupAgentKey,
  describeCacheWarmup,
} from "./model";
import { useCacheWarmupStore } from "./store";

// CUSTOM(cache-warmup): the composer toggle beside the Ctrl+M chip. On (the default) the flame is
// filled in a muted red; off it is an outline like the other toolbar icons. The tooltip says how
// long until the session's prompt cache goes cold.

const TOOLTIP_TICK_MS = 15_000;
// A desaturated red, so the filled flame stays quiet next to the gray toolbar icons in both themes.
const WARM_ICON_COLOR = "#7d5652";

function FilledFlame({ size, color }: AgentControlIconProps) {
  return <Flame size={size} color={color} fill={color} />;
}

function useCacheWarmupAgent(serverId: string, agentId: string) {
  const status = useSessionStore(
    (state) => state.sessions[serverId]?.agents.get(agentId)?.status ?? "idle",
  );
  const contextTokens = useSessionStore(
    (state) =>
      state.sessions[serverId]?.agents.get(agentId)?.lastUsage?.contextWindowUsedTokens ?? null,
  );
  // Same cache use time the pinger counts from.
  const lastUserMessageAt = useSessionStore(
    (state) => state.sessions[serverId]?.agents.get(agentId)?.lastUserMessageAt?.getTime() ?? null,
  );
  const lastTurnSeenAt = useCacheWarmupStore(
    (state) => state.lastTurnSeenAt[cacheWarmupAgentKey(serverId, agentId)] ?? null,
  );
  const lastCacheUseAt = cacheLastUsedAt({ lastUserMessageAt, lastTurnSeenAt });
  return { status, contextTokens, lastCacheUseAt };
}

function CacheWarmupTooltipText({
  serverId,
  agentId,
  enabled,
}: {
  serverId: string;
  agentId: string;
  enabled: boolean;
}) {
  const agent = useCacheWarmupAgent(serverId, agentId);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), TOOLTIP_TICK_MS);
    return () => clearInterval(interval);
  }, []);
  const lines = describeCacheWarmup({ enabled, ...agent, now });
  return <Text style={styles.tooltipText}>{lines.join("\n")}</Text>;
}

/** Renders only for a running Claude agent; drafts and other providers get nothing. */
export function CacheWarmupToggle({
  provider,
  serverId,
  agentId,
}: {
  provider: string;
  serverId: string | null;
  agentId: string | undefined;
}) {
  if (provider !== CACHE_WARMUP_PROVIDER || !serverId || !agentId) return null;
  return <AgentCacheWarmupToggle serverId={serverId} agentId={agentId} />;
}

function AgentCacheWarmupToggle({ serverId, agentId }: { serverId: string; agentId: string }) {
  const agentKey = cacheWarmupAgentKey(serverId, agentId);
  const enabled = useCacheWarmupStore((state) => !state.disabledAgentKeys.includes(agentKey));
  const handlePress = useCallback(() => {
    useCacheWarmupStore.getState().setEnabled(agentKey, !enabled);
  }, [agentKey, enabled]);
  return (
    <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
      <TooltipTrigger asChild triggerRefProp="ref">
        <AgentControlTrigger
          icon={enabled ? FilledFlame : Flame}
          iconColor={enabled ? WARM_ICON_COLOR : undefined}
          surface="toolbar"
          label="Keep cache warm"
          showToolbarLabel={false}
          onPress={handlePress}
          accessibilityLabel={enabled ? "Keep cache warm: on" : "Keep cache warm: off"}
          testID="cache-warmup-toggle"
        />
      </TooltipTrigger>
      <TooltipContent side="top" align="center" offset={8}>
        <CacheWarmupTooltipText serverId={serverId} agentId={agentId} enabled={enabled} />
      </TooltipContent>
    </Tooltip>
  );
}

const styles = StyleSheet.create((theme) => ({
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.4,
  },
}));
