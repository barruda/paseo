import { useMemo, type ReactElement } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { AgentStatusSummaryPayload } from "@getpaseo/protocol/messages";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { MenuRoot, MenuSurface, MenuTrigger, useMenuContext } from "@/components/ui/menu";
import { isWeb } from "@/constants/platform";
import { useSessionStore } from "@/stores/session-store";
import { formatTimeAgo } from "@/utils/time";

// CUSTOM(agent-status-summary): a line of small, soft text under the composer box says what this
// agent was asked and where the work stands, so a tab makes sense again after looking at five
// others. Plain text, not a pill: there to read when you want it, not competing for attention.
// Hovering it (web) or pressing it (native) shows both in full. The daemon writes the summary
// (packages/server/src/server/agent-status-summary.ts); the line only shows it.

const LINE_FONT_SIZE = 12;
const LINE_HEIGHT = 16;
const DETAILS_WIDTH = 480;

export function useAgentStatusSummary(serverId: string, agentId: string) {
  return useSessionStore((state) => state.sessions[serverId]?.agents.get(agentId)?.statusSummary);
}

export function AgentStatusLine({
  serverId,
  agentId,
}: {
  serverId: string;
  agentId: string;
}): ReactElement | null {
  const summary = useAgentStatusSummary(serverId, agentId);
  if (!summary) return null;
  // Only the topic shows; the request and status wait for a hover. Summaries written before
  // the topic existed fall back to the request.
  const text = summary.topic ?? summary.request;
  return (
    <View style={styles.row} testID="agent-status-line">
      {isWeb ? (
        <HoverCard>
          <HoverCardTrigger accessibilityLabel={text}>
            <Text style={styles.line} numberOfLines={1}>
              {text}
            </Text>
          </HoverCardTrigger>
          <HoverCardContent
            placement="top"
            offset={6}
            style={styles.card}
            testID="agent-status-line-details"
          >
            <StatusDetails summary={summary} />
          </HoverCardContent>
        </HoverCard>
      ) : (
        <MenuRoot compactMode="sheet">
          <NativeTrigger text={text} />
          <MenuSurface side="top" align="start" sheetTitle="Status">
            <StatusDetails summary={summary} />
          </MenuSurface>
        </MenuRoot>
      )}
    </View>
  );
}

function NativeTrigger({ text }: { text: string }) {
  const { open } = useMenuContext("AgentStatusLine");
  const accessibilityState = useMemo(() => ({ expanded: open }), [open]);
  return (
    <MenuTrigger
      accessibilityRole="button"
      accessibilityLabel={text}
      accessibilityState={accessibilityState}
    >
      <Text style={styles.line} numberOfLines={1}>
        {text}
      </Text>
    </MenuTrigger>
  );
}

/**
 * The request, status and call line. CUSTOM(task-summary-hover): the Tasks sidebar's hover card
 * reuses it with the topic on top, since its row shows the title instead.
 */
export function StatusDetails({
  summary,
  showTopic = false,
}: {
  summary: AgentStatusSummaryPayload;
  showTopic?: boolean;
}) {
  return (
    <View style={styles.details}>
      {showTopic && summary.topic ? <Text style={styles.detailsTopic}>{summary.topic}</Text> : null}
      <View style={styles.detailsBlock}>
        <Text style={styles.detailsLabel}>Request</Text>
        <Text style={styles.detailsText}>{summary.request}</Text>
      </View>
      <View style={styles.detailsBlock}>
        <Text style={styles.detailsLabel}>Status</Text>
        <Text style={styles.detailsText}>{summary.status}</Text>
      </View>
      <Text style={styles.detailsLabel}>{describeSummaryCall(summary)}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // Sits in the composer's bottom padding: the negative margin takes 10 px of it, so the box
  // moves up only a little.
  row: {
    width: "100%",
    maxWidth: theme.contentMaxWidth,
    alignSelf: "center",
    marginTop: -10,
    paddingHorizontal: theme.spacing[4] + theme.spacing[2],
    paddingBottom: theme.spacing[2],
  },
  line: {
    fontSize: LINE_FONT_SIZE,
    lineHeight: LINE_HEIGHT,
    color: theme.colors.foregroundMuted,
    opacity: 0.75,
  },
  card: {
    maxWidth: DETAILS_WIDTH,
  },
  details: {
    gap: theme.spacing[2],
    padding: theme.spacing[3],
  },
  detailsBlock: {
    gap: theme.spacing[1],
  },
  detailsLabel: {
    fontSize: theme.fontSize.sm,
    color: theme.colors.foregroundMuted,
  },
  detailsText: {
    fontSize: theme.fontSize.base,
    color: theme.colors.foreground,
  },
  detailsTopic: {
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
    color: theme.colors.foreground,
  },
}));

/** "Updated 3m ago · claude-haiku-5-5 · $0.0003", so the model and cost can be checked. */
function describeSummaryCall(summary: AgentStatusSummaryPayload): string {
  const parts = [`Updated ${formatTimeAgo(new Date(summary.updatedAt))}`];
  if (summary.model) parts.push(summary.model);
  if (summary.costUsd !== undefined) parts.push(`$${summary.costUsd.toFixed(4)}`);
  return parts.join(" · ");
}
