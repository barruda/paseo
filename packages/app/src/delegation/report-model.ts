// CUSTOM(delegation): what the Reports tab shows, from the plugin's report. Pure, so it is tested
// without rendering.

import type { DelegationGroup, DelegationReport } from "@getpaseo/protocol/delegation";

/** Below this many priced sessions in either group, the comparison is a hint, not a result. */
export const MIN_SESSIONS = 5;

export interface GroupView {
  sessions: string;
  costPerSession: string;
  subagentShare: string;
  contextPerTurn: string;
  turnsPerSession: string;
  delegationsPerSession: string;
}

export function formatDollars(value: number): string {
  return value >= 100 ? `$${value.toFixed(0)}` : `$${value.toFixed(2)}`;
}

export function formatTokens(value: number): string {
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  return `${Math.round(value / 1000)}k`;
}

function priced(group: DelegationGroup): number {
  return group.sessions - group.missing;
}

export function describeGroup(group: DelegationGroup): GroupView {
  const count = priced(group);
  const per = (value: number) => (count ? value / count : 0);
  const total = group.mainCost + group.subagentCost;
  return {
    sessions: group.missing ? `${count} (+${group.missing} without a transcript)` : String(count),
    costPerSession: count ? formatDollars(per(total)) : "–",
    subagentShare: total ? `${Math.round((group.subagentCost / total) * 100)}%` : "–",
    contextPerTurn: group.turns ? formatTokens(group.contextPerTurn) : "–",
    turnsPerSession: count ? per(group.turns).toFixed(0) : "–",
    delegationsPerSession: count ? per(group.cheapAgentCalls).toFixed(1) : "–",
  };
}

/** One line comparing the cost per session, with a warning while the sample is small. */
export function describeVerdict(report: DelegationReport): string {
  const on = priced(report.delegated);
  const off = priced(report.other);
  if (on === 0) return "No delegated session in this period yet.";
  if (off === 0) return "No session without delegation to compare with in this period.";
  const costOn = (report.delegated.mainCost + report.delegated.subagentCost) / on;
  const costOff = (report.other.mainCost + report.other.subagentCost) / off;
  if (costOff === 0) return "Sessions without delegation cost nothing to compare with.";
  const change = Math.round(((costOn - costOff) / costOff) * 100);
  const direction = change <= 0 ? `${-change}% less` : `${change}% more`;
  const line = `Delegated sessions cost ${direction} per session (${formatDollars(costOn)} vs ${formatDollars(costOff)}).`;
  return on < MIN_SESSIONS || off < MIN_SESSIONS
    ? `${line} Few sessions yet: sessions differ in size, so treat this as a hint.`
    : `${line} Sessions differ in size; compare context per turn too.`;
}
