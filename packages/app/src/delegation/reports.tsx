import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  DELEGATION_REPORT_DAYS,
  DELEGATION_RPC,
  DelegationReportSchema,
  type DelegationReport,
  type DelegationReportSession,
} from "@getpaseo/protocol/delegation";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { SegmentedControl, type SegmentedControlOption } from "@/components/ui/segmented-control";
import type { InstalledPlugin } from "@/plugins/types";
import { toErrorMessage } from "@/utils/error-messages";
import {
  describeGroup,
  describeVerdict,
  formatDollars,
  formatTokens,
  type GroupView,
} from "./report-model";

// CUSTOM(delegation): the sheet's Reports tab. The plugin prices this host's Opus/Fable Claude
// sessions from their transcripts and splits them by whether they started with the rule.

type Days = `${(typeof DELEGATION_REPORT_DAYS)[number]}`;

const DAY_OPTIONS: SegmentedControlOption<Days>[] = DELEGATION_REPORT_DAYS.map((days) => ({
  value: `${days}` as Days,
  label: `${days} days`,
  testID: `delegation-report-${days}`,
}));

const ROWS: { key: keyof GroupView; label: string }[] = [
  { key: "sessions", label: "Sessions" },
  { key: "costPerSession", label: "Cost per session" },
  { key: "subagentShare", label: "Subagent share of cost" },
  { key: "contextPerTurn", label: "Context per turn" },
  { key: "turnsPerSession", label: "Turns per session" },
  { key: "delegationsPerSession", label: "Delegations per session" },
];

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; report: DelegationReport };

export function DelegationReports({ plugin }: { plugin: InstalledPlugin }) {
  const [days, setDays] = useState<Days>("7");
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    plugin
      .invoke(DELEGATION_RPC.report, { days: Number(days) })
      .then((output) => {
        if (!cancelled) setState({ status: "ready", report: DelegationReportSchema.parse(output) });
      })
      .catch((error: unknown) => {
        if (!cancelled) setState({ status: "error", message: toErrorMessage(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [days, plugin, version]);

  return (
    <View style={styles.body} testID="delegation-reports">
      <View style={styles.toolbar}>
        <SegmentedControl options={DAY_OPTIONS} value={days} onValueChange={setDays} size="sm" />
        <Button
          variant="ghost"
          size="sm"
          onPress={reload}
          disabled={state.status === "loading"}
          testID="delegation-report-reload"
        >
          Refresh
        </Button>
      </View>
      {state.status === "loading" ? (
        <View style={styles.loading}>
          <LoadingSpinner size="large" color={styles.spinnerColor.color} />
          <Text style={styles.hint}>
            Reading the transcripts. The first time takes a few seconds; later reads are cached.
          </Text>
        </View>
      ) : null}
      {state.status === "error" ? <Text style={styles.errorText}>{state.message}</Text> : null}
      {state.status === "ready" ? <ReportBody report={state.report} /> : null}
    </View>
  );
}

function ReportBody({ report }: { report: DelegationReport }) {
  const on = describeGroup(report.delegated);
  const off = describeGroup(report.other);
  return (
    <>
      <Text style={styles.hint}>
        Opus/Fable Claude sessions on this host, priced at API rates from their transcripts (a
        subscription pays in usage limits, in about the same proportion).
      </Text>
      <Text style={styles.verdict} testID="delegation-report-verdict">
        {describeVerdict(report)}
      </Text>
      <View style={styles.table}>
        <View style={styles.tableRow}>
          <Text style={[styles.cell, styles.headCell, styles.labelCell]} />
          <Text style={[styles.cell, styles.headCell]}>Delegated</Text>
          <Text style={[styles.cell, styles.headCell]}>Not delegated</Text>
        </View>
        {ROWS.map((row) => (
          <View key={row.key} style={[styles.tableRow, styles.rowBorder]}>
            <Text style={[styles.cell, styles.labelCell]}>{row.label}</Text>
            <Text style={styles.cell}>{on[row.key]}</Text>
            <Text style={styles.cell}>{off[row.key]}</Text>
          </View>
        ))}
      </View>
      {report.sessions.length > 0 ? (
        <View style={styles.list}>
          <Text style={styles.label}>Sessions</Text>
          {report.sessions.map((session) => (
            <SessionRow key={session.agentId} session={session} />
          ))}
        </View>
      ) : null}
    </>
  );
}

function SessionRow({ session }: { session: DelegationReportSession }) {
  const date = new Date(session.lastActivityAt).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const total = session.mainCost + session.subagentCost;
  const facts = [
    date,
    `${formatDollars(total)}${session.subagentCost ? ` (sub ${formatDollars(session.subagentCost)})` : ""}`,
    `${formatTokens(session.contextPerTurn)}/turn`,
    `${session.turns} turns`,
  ];
  if (session.cheapAgentCalls) facts.push(`${session.cheapAgentCalls} delegated`);
  if (session.fixMessages) facts.push(`${session.fixMessages} fixes sent`);
  return (
    <View style={[styles.session, styles.rowBorder]} testID="delegation-report-session">
      <Text style={styles.sessionTitle} numberOfLines={1}>
        {session.delegated ? "● " : "○ "}
        {session.title ?? session.cwd}
      </Text>
      <Text style={styles.hint}>{facts.join(" · ")}</Text>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  body: {
    gap: theme.spacing[3],
    paddingBottom: theme.spacing[2],
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  loading: {
    gap: theme.spacing[3],
    alignItems: "center",
    justifyContent: "center",
    minHeight: 180,
  },
  spinnerColor: {
    color: theme.colors.foregroundMuted,
  },
  hint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: theme.fontSize.sm * 1.4,
  },
  verdict: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    lineHeight: theme.fontSize.base * 1.4,
  },
  label: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  table: {
    borderWidth: 1,
    borderColor: theme.colors.border,
    borderRadius: theme.borderRadius.md,
  },
  tableRow: {
    flexDirection: "row",
    paddingHorizontal: theme.spacing[3],
    paddingVertical: theme.spacing[2],
  },
  rowBorder: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  cell: {
    flex: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    textAlign: "right",
  },
  labelCell: {
    flex: 1.6,
    textAlign: "left",
    color: theme.colors.foregroundMuted,
  },
  headCell: {
    color: theme.colors.foregroundMuted,
  },
  list: {
    gap: 0,
  },
  session: {
    paddingVertical: theme.spacing[2],
    gap: 2,
  },
  sessionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  errorText: {
    color: theme.colors.statusDanger,
    fontSize: theme.fontSize.base,
  },
}));
