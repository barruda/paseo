import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { UsageCard } from "./card";
import { useUsageDisplay } from "./display";
import { useAgentUsage } from "./queries";
import { useSessionStore } from "@/stores/session-store";
import type { UsageReportEntry } from "./types";

/**
 * The usage of the account an agent runs under, for its context window details: one card per
 * report as it streams in, without pins. Nothing on hosts that cannot report usage, or for an
 * agent with no account to report.
 */
export function AgentUsage({
  serverId,
  agentId,
  refreshable,
}: {
  serverId: string;
  agentId: string;
  /** Whether each card has a Refresh button; a surface that cannot be pressed hides it. */
  refreshable: boolean;
}) {
  // CUSTOM(draft-composer-ready): a draft's meter has no agent to ask the daemon about yet.
  const isKnownAgent = useSessionStore((state) => {
    const session = state.sessions[serverId];
    return Boolean(session?.agents.get(agentId) ?? session?.agentDetails.get(agentId));
  });
  if (!isKnownAgent) return null;
  return <KnownAgentUsage serverId={serverId} agentId={agentId} refreshable={refreshable} />;
}

function KnownAgentUsage({
  serverId,
  agentId,
  refreshable,
}: {
  serverId: string;
  agentId: string;
  refreshable: boolean;
}) {
  const { t } = useTranslation();
  const view = useAgentUsage(serverId, agentId);
  if (view.kind === "none") return null;
  return (
    <>
      <View style={styles.divider} />
      {view.kind === "ready" ? (
        <AgentUsageCards
          serverId={serverId}
          agentId={agentId}
          reports={view.reports}
          refreshable={refreshable}
        />
      ) : (
        <Text style={styles.message}>
          {view.kind === "loading" ? t("providerUsage.loading") : view.message}
        </Text>
      )}
    </>
  );
}

function AgentUsageCards({
  serverId,
  agentId,
  reports,
  refreshable,
}: {
  serverId: string;
  agentId: string;
  reports: readonly UsageReportEntry[];
  refreshable: boolean;
}) {
  const { display } = useUsageDisplay(reports);
  return reports.map((entry) => (
    <UsageCard
      key={entry.id}
      serverId={serverId}
      agentId={agentId}
      entry={entry}
      display={display}
      compact
      pinnable={false}
      refreshable={refreshable}
    />
  ));
}

const styles = StyleSheet.create((theme) => ({
  divider: { height: 1, backgroundColor: theme.colors.borderAccent },
  message: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
}));
