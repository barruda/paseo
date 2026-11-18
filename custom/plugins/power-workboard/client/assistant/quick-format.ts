// CUSTOM(assistant-quick): pure helpers of the sidebar status row and the quick-message popover.
import type { QuickMessage, QuickStatus } from "../../shared/quick";

export type QuickColor =
  | "statusSuccess"
  | "statusWarning"
  | "statusDanger"
  | "foregroundMuted";

export function quickVisual(status: QuickStatus): {
  icon: string;
  color: QuickColor;
} {
  switch (status) {
    case "ok":
      return { icon: "CircleCheck", color: "statusSuccess" };
    case "needs-input":
      return { icon: "TriangleAlert", color: "statusWarning" };
    case "error":
      return { icon: "CircleX", color: "statusDanger" };
    case "pending":
      return { icon: "Clock", color: "foregroundMuted" };
  }
}

export interface QuickStrings {
  pending: string;
  idle: string;
}

export function quickLabel(item: QuickMessage | null, s: QuickStrings): string {
  if (!item) return s.idle;
  if (item.status === "pending") return s.pending;
  return item.message ?? s.pending;
}

/** Where a press on a message goes: the assistant chat, scrolled to that message. */
export function conversationTarget(
  item: QuickMessage,
): { agentId: string; turnStartedAt: string } | null {
  if (!item.agentId) return null;
  return { agentId: item.agentId, turnStartedAt: item.sentAt };
}

export function quickPollMs(items: readonly QuickMessage[]): number {
  return items.some((item) => item.status === "pending") ? 2_000 : 15_000;
}

// CUSTOM(status-bar): the assistant chat agent's own status summary, shown after the ack in the
// app's status bar (the line under the chat's composer is hidden there).

/** The parts of the daemon's agent status summary the status bar shows. */
export interface AssistantSummary {
  topic?: string;
  firstTopic?: string;
  request: string;
  status: string;
}

export interface AssistantAgentEntry {
  id: string;
  updatedAt: string;
  archivedAt?: string | null;
  labels?: Readonly<Record<string, string>>;
  statusSummary?: AssistantSummary;
}

/** "first topic › current topic", like the composer's status line; null without a summary. */
export function assistantTopic(
  summary: AssistantSummary | undefined,
): string | null {
  if (!summary) return null;
  const { firstTopic, topic } = summary;
  // Summaries written before topics existed fall back to the request.
  if (!topic) return firstTopic || summary.request || null;
  if (!firstTopic || firstTopic === topic) return topic;
  return `${firstTopic} › ${topic}`;
}

/** The live assistant chat: the newest unarchived agent carrying the chat label. */
export function pickAssistantAgent(
  agents: Iterable<AssistantAgentEntry>,
  label: string,
): AssistantAgentEntry | null {
  let best: AssistantAgentEntry | null = null;
  for (const agent of agents) {
    if (agent.archivedAt || agent.labels?.[label] !== "true") continue;
    if (!best || agent.updatedAt > best.updatedAt) best = agent;
  }
  return best;
}
