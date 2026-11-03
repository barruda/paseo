import { useDenseLayout } from "./layout.ts";
import type { PluginTheme } from "@getpaseo/plugin";
import { useAgent, useRpc, useSettings, type PluginAgentPanelProps } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/react-native";
import { useLedger } from "./data.ts";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Linking, Pressable, Text, View, type PressableStateCallbackType } from "react-native";

/** React Native Web adds `hovered` to Pressable's state. */
type PressState = PressableStateCallbackType & { hovered?: boolean };
import type { Ctx, InFlight, TurnRow } from "../shared/ledger.ts";
import { preferences } from "../shared/preferences.ts";
import { ledgerTrace } from "../shared/trace.ts";
import { cacheRatio } from "../shared/pricing.ts";
import {
  fmtCost,
  fmtCostSmall,
  fmtDuration,
  fmtPct,
  fmtResidual,
  fmtTime,
  fmtTokens,
  statusColor,
  SummaryRow,
  tokensLine,
  turnColumns,
  TurnTableHeader,
  UsageCoverageNote,
} from "./ui.tsx";

function useElapsed(startedAt: string | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [startedAt]);
  if (!startedAt) return "";
  return fmtDuration(Math.max(0, now - Date.parse(startedAt)));
}

function CtxBar({ ctx, theme }: { ctx: Ctx; theme: PluginTheme }) {
  const ratio = ctx.max > 0 ? Math.min(1, ctx.used / ctx.max) : 0;
  return (
    <View style={{ gap: 4 }}>
      <View style={{ height: 4, borderRadius: 2, backgroundColor: theme.colors.border, overflow: "hidden" }}>
        <View
          style={{
            width: `${Math.round(ratio * 100)}%`,
            height: 4,
            borderRadius: 2,
            backgroundColor: theme.colors.accent,
          }}
        />
      </View>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11, fontVariant: ["tabular-nums"] }}>
        context {fmtTokens(ctx.used)} / {fmtTokens(ctx.max)}
      </Text>
    </View>
  );
}

function InFlightCard({ inFlight, seq, theme }: { inFlight: InFlight; seq: number; theme: PluginTheme }) {
  const elapsed = useElapsed(inFlight.startedAt);
  const tokens = tokensLine(inFlight.input, inFlight.cached, inFlight.output, inFlight.cacheWrite);
  const pct = fmtPct(cacheRatio(inFlight.input, inFlight.cached, inFlight.cacheWrite));
  const ctx = inFlight.ctxUsed !== null && inFlight.ctxMax !== null ? { used: inFlight.ctxUsed, max: inFlight.ctxMax } : null;
  return (
    <View
      style={{
        backgroundColor: theme.colors.surface1,
        borderColor: theme.colors.accent,
        borderWidth: 1,
        borderRadius: 10,
        padding: 12,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: theme.colors.accent }} />
        <Text style={{ color: theme.colors.foreground, fontSize: 13, fontWeight: "600", flex: 1 }}>
          Turn #{seq} in progress
        </Text>
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontVariant: ["tabular-nums"] }}>
          {elapsed}
        </Text>
      </View>
      {tokens ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontVariant: ["tabular-nums"] }}>
          {tokens}
          {pct ? ` (${pct} cached)` : ""}
          {inFlight.modelCalls > 0 ? ` · ${inFlight.modelCalls} call${inFlight.modelCalls > 1 ? "s" : ""}` : ""}
        </Text>
      ) : (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontStyle: "italic" }}>
          tokens & cost reported at turn end
        </Text>
      )}
      {inFlight.effectiveCostUsd !== null ? (
        <Text style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontVariant: ["tabular-nums"] }}>
          ≈{fmtCost(inFlight.effectiveCostUsd)} current turn
        </Text>
      ) : null}
      {ctx ? <CtxBar ctx={ctx} theme={theme} /> : null}
      {inFlight.usageGap ? <Text style={{ color: theme.colors.foregroundMuted, fontSize: 11 }}>Connection interrupted · usage may be incomplete.</Text> : null}
    </View>
  );
}

/** One cell of the TURNS table: tokens on top, estimated cost below. */
function TurnCell({
  top,
  bottom,
  width,
  theme,
}: {
  top: string;
  bottom: string;
  width: { minWidth: number };
  theme: PluginTheme;
}) {
  return (
    <View style={{ ...width, alignItems: "flex-end" }}>
      <Text style={{ color: theme.colors.foreground, fontSize: 12, fontVariant: ["tabular-nums"] }}>{top}</Text>
      <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10, fontVariant: ["tabular-nums"] }}>
        {bottom}
      </Text>
    </View>
  );
}

type Navigation = NonNullable<PluginAgentPanelProps["navigation"]>;
// CUSTOM(turn-jump): our Paseo's openAgent also takes the turn's start; the published SDK types
// don't list it yet.
type OpenAgentAtTurn = (input: { agentId: string; turnStartedAt?: string }) => void;

type TraceState = "idle" | "loading" | "missing" | "error";

/** CUSTOM(token-ledger-trace): opens the turn's MLflow trace, looked up on press. */
function TraceLink({ record, workspaceId, navigation, theme }: {
  record: TurnRow; workspaceId: string; navigation: Navigation | undefined; theme: PluginTheme;
}) {
  const lookup = useRpc(ledgerTrace);
  const [state, setState] = useState<TraceState>("idle");
  const [message, setMessage] = useState<string | null>(null);
  const sessionId = record.sessionId;
  const startedAt = record.startedAt;
  if (!sessionId || !startedAt) return null;
  const open = async () => {
    setState("loading");
    try {
      const result = await lookup({ sessionId, startedAt });
      if (result.status === "found") {
        setState("idle");
        if (navigation?.openBrowser) navigation.openBrowser({ url: result.url, workspaceId });
        else await Linking.openURL(result.url);
        return;
      }
      setState(result.status === "error" ? "error" : "missing");
      setMessage(result.status === "error" ? result.message : null);
    } catch (error) {
      setState("error");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  };
  const label = state === "loading" ? "trace…" : state === "missing" ? "no trace" : state === "error" ? "trace failed" : "trace ↗";
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={message ? `MLflow trace: ${message}` : "Open the MLflow trace of this turn"}
      disabled={state === "loading"}
      onPress={() => { void open(); }}
      hitSlop={4}
    >
      {({ hovered }: PressState) => (
        <Text style={{
          color: state === "error" ? theme.colors.statusDanger : theme.colors.accent,
          fontSize: 10,
          textDecorationLine: hovered ? "underline" : "none",
        }}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

function RecordRow({ record, theme, dense, onOpenTurn, traceLink }: {
  record: TurnRow; theme: PluginTheme; dense: boolean;
  /** CUSTOM(turn-jump): scrolls the agent's chat to this turn. */
  onOpenTurn?: () => void;
  traceLink?: ReactNode;
}) {
  const cols = turnColumns(dense);
  const hasUsage = record.input !== null || record.cached !== null || record.output !== null || record.cacheWrite != null;
  const split = record.costBreakdown;
  const pct = fmtPct(cacheRatio(record.input, record.cached, record.cacheWrite));
  const cacheCost = split ? fmtCostSmall(split.cacheUsd) : "–";
  const costDetail =
    record.costSource === "override"
      ? "override"
      : record.costSource === "openrouter"
        ? "OR ref"
        : record.costSource === "builtin"
          ? "list"
          : fmtResidual(split?.otherUsd ?? null);
  const seqWidth = dense ? 20 : 24;
  return (
    <Pressable
      disabled={!onOpenTurn}
      onPress={onOpenTurn}
      accessibilityRole={onOpenTurn ? "button" : undefined}
      accessibilityLabel={onOpenTurn ? `Show turn ${record.seq} in the chat` : undefined}
      style={({ hovered, pressed }: PressState) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: cols.gap,
        paddingVertical: 6,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
        backgroundColor: onOpenTurn && (hovered || pressed) ? theme.colors.surface1 : "transparent",
      })}
    >
      <View style={{ flex: 1, minWidth: dense ? 72 : 88 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: statusColor(record.status, theme) }} />
          <Text
            style={{ color: theme.colors.foregroundMuted, fontSize: 12, fontVariant: ["tabular-nums"], minWidth: seqWidth }}
          >
            #{record.seq}
          </Text>
          <Text numberOfLines={1} style={{ color: theme.colors.foreground, fontSize: 12, fontVariant: ["tabular-nums"] }}>
            {fmtTime(record.endedAt)}
          </Text>
        </View>
        {/* Align under the time text: dot(7) + gap(6) + seq col + gap(6). */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingLeft: 19 + seqWidth }}>
          <Text
            numberOfLines={1}
            style={{ color: theme.colors.foregroundMuted, fontSize: 10, fontVariant: ["tabular-nums"] }}
          >
            {fmtDuration(record.durationMs)}
              {record.usageGap ? ' · gap' : record.quality === "partial" ? " ≈" : ""}
          </Text>
          {traceLink}
        </View>
      </View>
      {hasUsage ? (
        <>
          <TurnCell
            top={fmtTokens(record.input)}
            bottom={split ? fmtCostSmall(split.inUsd) : "–"}
            width={cols.in}
            theme={theme}
          />
          <View style={{ gap: 3 }}>
            <TurnCell
              top={fmtTokens(record.cached)}
              bottom={pct ? `${cacheCost}·${pct}` : cacheCost}
              width={cols.cache}
              theme={theme}
            />
            {record.cacheWrite != null ? (
              <TurnCell top={`${fmtTokens(record.cacheWrite)} write`}
                bottom={split ? fmtCostSmall(split.cacheWriteUsd ?? 0) : '–'} width={cols.cache} theme={theme} />
            ) : null}
          </View>
          <TurnCell
            top={fmtTokens(record.output)}
            bottom={split ? fmtCostSmall(split.outUsd) : "–"}
            width={cols.out}
            theme={theme}
          />
        </>
      ) : (
        <Text
          style={{
            color: theme.colors.foregroundMuted,
            fontSize: 11,
            fontStyle: "italic",
            minWidth: cols.in.minWidth + cols.cache.minWidth + cols.out.minWidth + cols.gap * 2,
            textAlign: "right",
          }}
        >
          usage unavailable
        </Text>
      )}
      <TurnCell
        top={`${record.costSource && record.costSource !== "reported" ? "≈" : ""}${fmtCost(record.effectiveCostUsd) ?? "–"}`}
        bottom={costDetail}
        width={cols.cost}
        theme={theme}
      />
    </Pressable>
  );
}

export function TokenLedgerPanel({ theme, layout, agentId, workspaceId, navigation }: PluginAgentPanelProps) {
  const { dense, setWidth } = useDenseLayout(layout.compact);
  const { data, error } = useLedger(agentId);
  const settings = useSettings(preferences);
  const tracesOn = settings.status === "ready" && settings.values.mlflowUrl.trim() !== "";
  const openAgent = navigation?.openAgent as OpenAgentAtTurn | undefined;
  // Make the panel↔agent binding visible: which session is this ledger for?
  const agentLabel = useAgent(agentId, (agent) => {
    const name = agent.title ?? agentId.slice(0, 8);
    return agent.model ? `${name} · ${agent.model}` : name;
  });

  const styles = useMemo(
    () => ({
      screen: { flex: 1, backgroundColor: theme.colors.surface0 },
      content: { padding: dense ? 10 : 20, gap: 14 },
      sectionLabel: {
        color: theme.colors.foregroundMuted,
        fontSize: 11,
        fontWeight: "600" as const,
        letterSpacing: 0.6,
        textTransform: "uppercase" as const,
      },
      muted: { color: theme.colors.foregroundMuted, fontSize: 13 },
    }),
    [theme, dense],
  );

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {error ? <Text style={{ color: theme.colors.statusDanger, fontSize: 13 }}>{String(error)}</Text> : null}
      {data ? (
        <>
          <View style={{ gap: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "baseline", gap: 8 }}>
              <Text style={styles.sectionLabel}>Session</Text>
              <Text numberOfLines={1} style={{ ...styles.muted, fontSize: 12, flexShrink: 1 }}>
                {agentLabel ?? agentId.slice(0, 8)}
              </Text>
            </View>
            <SummaryRow summary={data.summary} theme={theme} dense={dense} />
            <UsageCoverageNote theme={theme} />
            {!data.inFlight && data.ctx ? <CtxBar ctx={data.ctx} theme={theme} /> : null}
          </View>
          {data.inFlight ? <InFlightCard inFlight={data.inFlight} seq={data.summary.turns + 1} theme={theme} /> : null}
          <View style={{ gap: 2 }}>
            <TurnTableHeader theme={theme} dense={dense} />
            {data.records.length === 0 && !data.inFlight ? (
              <Text style={styles.muted}>
                No turns recorded yet. Usage is tracked per turn while this plugin is running.
              </Text>
            ) : (
              <>
                {data.records.map((record) => (
                  // Keyed by seq, not record.id: ids of records persisted before
                  // v0.1.x lack the endedAt component and collide across session
                  // restarts (turnId reuse), which made React render ghost rows.
                  <RecordRow
                    key={record.seq}
                    record={record}
                    theme={theme}
                    dense={dense}
                    onOpenTurn={openAgent && record.startedAt
                      ? () => openAgent({ agentId, turnStartedAt: record.startedAt ?? undefined })
                      : undefined}
                    traceLink={tracesOn
                      ? <TraceLink record={record} workspaceId={workspaceId} navigation={navigation} theme={theme} />
                      : null}
                  />
                ))}
                {data.records.some((record) => fmtResidual(record.costBreakdown?.otherUsd ?? null).trim() !== "") ? (
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10, paddingTop: 6 }}>
                    ± under COST: difference between reported cost and the token-based estimate, including charges
                    for usage Paseo does not expose.
                  </Text>
                ) : null}
                {data.records.some((record) => record.costSource && record.costSource !== "reported") ? (
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10, paddingTop: 4 }}>
                    ≈ estimated: override = local pricing.json · OR ref = OpenRouter reference · list = built-in prices.
                  </Text>
                ) : null}
                {data.records.some((record) => record.usageGap) ? (
                  <Text style={{ color: theme.colors.foregroundMuted, fontSize: 10, paddingTop: 4 }}>
                    gap: connection interrupted; usage may be incomplete. A missing turn outcome is recorded as unknown.
                  </Text>
                ) : null}
              </>
            )}
          </View>
        </>
      ) : (
        <Text style={styles.muted}>Loading…</Text>
      )}
    </ScrollView>
  );
}
