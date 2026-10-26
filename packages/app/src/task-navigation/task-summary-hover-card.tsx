import type { ReactNode } from "react";
import { StyleSheet } from "react-native-unistyles";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { StatusDetails, useAgentStatusSummary } from "@/composer/agent-status-line";
import { useIsCompactFormFactor } from "@/constants/layout";

// CUSTOM(task-summary-hover): resting the pointer on a Tasks sidebar row shows the agent's status
// summary, the one under its composer, so you can tell sessions apart without opening them.

/** Long enough that sweeping the pointer down the list doesn't flash a card per row. */
const OPEN_DELAY_MS = 400;
const CARD_WIDTH = 360;

export function TaskSummaryHoverCard({
  serverId,
  agentId,
  children,
}: {
  serverId: string;
  agentId: string;
  children: ReactNode;
}): ReactNode {
  const summary = useAgentStatusSummary(serverId, agentId);
  const isCompact = useIsCompactFormFactor();
  if (!summary || isCompact) return children;
  return (
    <HoverCard openDelayMs={OPEN_DELAY_MS}>
      <HoverCardTrigger>{children}</HoverCardTrigger>
      <HoverCardContent
        placement="right"
        offset={8}
        style={styles.card}
        testID="task-summary-hover-card"
      >
        <StatusDetails summary={summary} showTopic />
      </HoverCardContent>
    </HoverCard>
  );
}

const styles = StyleSheet.create({
  card: {
    width: CARD_WIDTH,
  },
});
