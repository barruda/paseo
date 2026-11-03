import { useCallback, useMemo, useState, type ComponentType } from "react";
import { Text, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { AlertTriangle, Check, MoreHorizontal, ScanEye } from "lucide-react-native";
import { isCriticEnabledLabels, type CriticReviewStatus } from "@getpaseo/protocol/critic";
import { AgentControlTrigger } from "@/composer/agent-controls/control";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useSessionStore } from "@/stores/session-store";
import type { AgentControlIconProps } from "@/agent-controls/icons";
import type { Theme } from "@/styles/theme";
import { describeCritic, latestCriticStatus } from "./model";
import { CriticSettingsSheet } from "./sheet";
import { useCriticStore } from "./store";

// CUSTOM(critic): the composer icon after the cache flame. Off it is an outline like the other
// toolbar icons; on it is tinted and carries a badge for the last review (check when approved,
// warning when the loop ended without approval, dots while the critic reads). A press opens the
// critic settings.

// A desaturated blue, so the tinted icon stays quiet next to the gray toolbar icons in both themes.
const ON_ICON_COLOR = "#56677d";

type CriticBadge = "approved" | "warning" | "busy" | null;

function badgeFor(status: CriticReviewStatus | null): CriticBadge {
  if (status === "approved") return "approved";
  if (status === "limit" || status === "failed") return "warning";
  if (status === "reviewing" || status === "rejected") return "busy";
  return null;
}

const BadgeGlyphs: Record<Exclude<CriticBadge, null>, ComponentType<AgentControlIconProps>> = {
  approved: Check,
  warning: AlertTriangle,
  busy: MoreHorizontal,
};

const ThemedBadgeGlyph = withUnistyles(
  ({ badge, size, color }: { badge: Exclude<CriticBadge, null>; size: number; color: string }) => {
    const Glyph = BadgeGlyphs[badge];
    return <Glyph size={size} color={color} />;
  },
  (theme: Theme) => ({ color: theme.colors.palette.white }),
);

function iconWithBadge(badge: CriticBadge): ComponentType<AgentControlIconProps> {
  return function CriticIcon({ size, color }: AgentControlIconProps) {
    const badgeSize = Math.round(size * 0.6);
    const frameStyle = useMemo(() => ({ width: size, height: size }), [size]);
    const badgeStyle = useMemo(
      () => [
        styles.badge,
        badge === "approved" && styles.badgeApproved,
        badge === "warning" && styles.badgeWarning,
        badge === "busy" && styles.badgeBusy,
        { width: badgeSize, height: badgeSize, borderRadius: badgeSize / 2 },
      ],
      [badgeSize],
    );
    return (
      <View style={frameStyle}>
        <ScanEye size={size} color={color} />
        {badge ? (
          <View style={badgeStyle}>
            <ThemedBadgeGlyph badge={badge} size={Math.round(badgeSize * 0.75)} />
          </View>
        ) : null}
      </View>
    );
  };
}

const ICONS: Record<string, ComponentType<AgentControlIconProps>> = {
  off: ScanEye,
  none: iconWithBadge(null),
  approved: iconWithBadge("approved"),
  warning: iconWithBadge("warning"),
  busy: iconWithBadge("busy"),
};

function useLatestCriticStatus(serverId: string, agentId: string): CriticReviewStatus | null {
  return useSessionStore((state) => {
    const session = state.sessions[serverId];
    if (!session) return null;
    return (
      latestCriticStatus(session.agentStreamHead.get(agentId) ?? []) ??
      latestCriticStatus(session.agentStreamTail.get(agentId) ?? [])
    );
  });
}

/** Renders for a running agent, and for a draft that passes `draftKey` (draft-composer-ready). */
export function CriticToggle({
  serverId,
  agentId,
  draftKey,
}: {
  serverId: string | null;
  agentId: string | undefined;
  draftKey?: string;
}) {
  if (!serverId) return null;
  if (agentId) return <AgentCriticToggle serverId={serverId} agentId={agentId} />;
  if (draftKey) return <DraftCriticToggle serverId={serverId} draftKey={draftKey} />;
  return null;
}

// CUSTOM(draft-composer-ready): before the session exists the sheet saves to the draft, and the
// draft's create request applies it (`./draft.ts`).
function DraftCriticToggle({ serverId, draftKey }: { serverId: string; draftKey: string }) {
  const setup = useCriticStore((state) => state.drafts[draftKey]);
  const enabled = setup?.config.enabled ?? false;
  const [open, setOpen] = useState(false);
  const handlePress = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);
  const model = setup ? `${setup.config.provider}/${setup.config.model}` : null;
  const lines = [
    ...describeCritic({ enabled, model, status: null }),
    "Applies when the session starts",
  ];
  return (
    <>
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild triggerRefProp="ref">
          <AgentControlTrigger
            icon={(enabled ? ICONS.none : ICONS.off) ?? ScanEye}
            iconColor={enabled ? ON_ICON_COLOR : undefined}
            surface="toolbar"
            label="Critic"
            showToolbarLabel={false}
            onPress={handlePress}
            accessibilityLabel={enabled ? "Critic: on" : "Critic: off"}
            testID="critic-toggle"
          />
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <Text style={styles.tooltipText}>{lines.join("\n")}</Text>
        </TooltipContent>
      </Tooltip>
      {open ? (
        <CriticSettingsSheet
          key={`${serverId}:${draftKey}`}
          serverId={serverId}
          agentId={draftKey}
          isDraft
          onClose={handleClose}
        />
      ) : null}
    </>
  );
}

function AgentCriticToggle({ serverId, agentId }: { serverId: string; agentId: string }) {
  const enabled = useSessionStore((state) => {
    const labels = state.sessions[serverId]?.agents.get(agentId)?.labels;
    return labels ? isCriticEnabledLabels(labels) : false;
  });
  const status = useLatestCriticStatus(serverId, agentId);
  const model = useCriticStore((state) => state.models[agentId] ?? null);
  const [open, setOpen] = useState(false);
  const handlePress = useCallback(() => setOpen(true), []);
  const handleClose = useCallback(() => setOpen(false), []);
  const badge = badgeFor(status);
  const icon = enabled ? ICONS[badge ?? "none"] : ICONS.off;
  const lines = describeCritic({ enabled, model, status });
  return (
    <>
      <Tooltip delayDuration={0} enabledOnDesktop enabledOnMobile={false}>
        <TooltipTrigger asChild triggerRefProp="ref">
          <AgentControlTrigger
            icon={icon ?? ScanEye}
            iconColor={enabled ? ON_ICON_COLOR : undefined}
            surface="toolbar"
            label="Critic"
            showToolbarLabel={false}
            onPress={handlePress}
            accessibilityLabel={enabled ? "Critic: on" : "Critic: off"}
            testID="critic-toggle"
          />
        </TooltipTrigger>
        <TooltipContent side="top" align="center" offset={8}>
          <Text style={styles.tooltipText}>{lines.join("\n")}</Text>
        </TooltipContent>
      </Tooltip>
      {open ? (
        <CriticSettingsSheet
          key={`${serverId}:${agentId}`}
          serverId={serverId}
          agentId={agentId}
          onClose={handleClose}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  tooltipText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.4,
  },
  badge: {
    position: "absolute",
    right: -3,
    bottom: -3,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeApproved: {
    backgroundColor: theme.colors.statusSuccess,
  },
  badgeWarning: {
    backgroundColor: theme.colors.statusWarning,
  },
  badgeBusy: {
    backgroundColor: theme.colors.foregroundMuted,
  },
}));
